import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { app } from './app';
import { config } from './config';
import { sql } from './db';
import { resetSchema } from './test-support/reset-db';

const polygon = {
  type: 'Polygon',
  coordinates: [
    [
      [-122.42, 47.61],
      [-122.4, 47.61],
      [-122.4, 47.63],
      [-122.42, 47.63],
      [-122.42, 47.61],
    ],
  ],
};
const pointInside = { lat: 47.62, lon: -122.41 };
const pointOutside = { lat: 0, lon: 0 };

const now = Date.now();
const minutes = (n: number) => new Date(now + n * 60_000).toISOString();

async function jsonBody<T = unknown>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

beforeAll(async () => {
  await resetSchema();
});

afterAll(async () => {
  await sql.close();
});

describe('weather_service (end-to-end)', () => {
  test('rejects a body-carrying request with the wrong Content-Type', async () => {
    const res = await app.request('/api/v1/visibility-zones/IT-ZONE/observed-reports', {
      method: 'POST',
      body: JSON.stringify({ reportId: 'wrong-content-type', recordedAt: minutes(0), state: 'clear', polygon }),
    });
    expect(res.status).toBe(415);
  });

  test('validation failures return { message } like every other error, not the default ZodError shape', async () => {
    const res = await app.request('/api/v1/visibility-zones/IT-ZONE/observed-reports', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recordedAt: minutes(0) }),
    });
    expect(res.status).toBe(400);
    const body = await jsonBody<{ message: string }>(res);
    expect(typeof body.message).toBe('string');
    expect(body).not.toHaveProperty('success');
    expect(body).not.toHaveProperty('error');
  });

  describe('visibility zones', () => {
    test('ingests observed reports and is idempotent on retry', async () => {
      const report = { reportId: 'it-vobs-1', recordedAt: minutes(-5), state: 'clear', polygon };

      const ingestRes = await app.request('/api/v1/visibility-zones/it-vis-fresh/observed-reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(report),
      });
      expect(ingestRes.status).toBe(201);
      expect(await ingestRes.json()).toHaveLength(1);

      const retryRes = await app.request('/api/v1/visibility-zones/it-vis-fresh/observed-reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(report),
      });
      expect(retryRes.status).toBe(201);
      expect(await retryRes.json()).toEqual([]);
    });

    test('ingests a stale observed report for a second zone', async () => {
      const staleReport = {
        reportId: 'it-vobs-stale-1',
        recordedAt: minutes(-(config.ZONE_STALE_AFTER_MINUTES + 60)),
        state: 'stormy',
        polygon,
      };
      const res = await app.request('/api/v1/visibility-zones/it-vis-stale/observed-reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(staleReport),
      });
      expect(res.status).toBe(201);
      expect(await res.json()).toHaveLength(1);
    });

    test('GET /observed returns the fresh zone but excludes the dissipated one', async () => {
      const res = await app.request('/api/v1/visibility-zones/observed');
      expect(res.status).toBe(200);
      const zoneIds = (await jsonBody<{ zoneId: string }[]>(res)).map((r) => r.zoneId);
      expect(zoneIds).toContain('it-vis-fresh');
      expect(zoneIds).not.toContain('it-vis-stale');
    });

    test('GET /observed?at= resolves the dissipated zone as of that time (staleness bypassed)', async () => {
      const at = minutes(-(config.ZONE_STALE_AFTER_MINUTES + 30));
      const res = await app.request(`/api/v1/visibility-zones/observed?at=${encodeURIComponent(at)}`);
      const zoneIds = (await jsonBody<{ zoneId: string }[]>(res)).map((r) => r.zoneId);
      expect(zoneIds).toEqual(['it-vis-stale']);
    });

    test('GET /it-vis-stale/observed-reports/latest 404s once the zone has dissipated', async () => {
      const res = await app.request('/api/v1/visibility-zones/it-vis-stale/observed-reports/latest');
      expect(res.status).toBe(404);
    });

    test('GET /observed/current filters by point-in-polygon containment', async () => {
      const insideRes = await app.request(
        `/api/v1/visibility-zones/observed/current?lat=${pointInside.lat}&lon=${pointInside.lon}`,
      );
      const insideZoneIds = (await jsonBody<{ zoneId: string }[]>(insideRes)).map((r) => r.zoneId);
      expect(insideZoneIds).toContain('it-vis-fresh');

      const outsideRes = await app.request(
        `/api/v1/visibility-zones/observed/current?lat=${pointOutside.lat}&lon=${pointOutside.lon}`,
      );
      expect(await jsonBody<unknown[]>(outsideRes)).toEqual([]);
    });

    test('GET /observed/current filters by extent intersection, order-independent', async () => {
      const intersecting = 'lat1=47.60&lon1=-122.43&lat2=47.64&lon2=-122.39';
      const intersectingRes = await app.request(`/api/v1/visibility-zones/observed/current?${intersecting}`);
      const intersectingZoneIds = (await jsonBody<{ zoneId: string }[]>(intersectingRes)).map((r) => r.zoneId);
      expect(intersectingZoneIds).toContain('it-vis-fresh');

      // Same extent with both corners' lat and lon swapped — should resolve to the same result,
      // proving lat1/lon1/lat2/lon2 are normalized rather than requiring a specific corner order.
      const swapped = 'lat1=47.64&lon1=-122.39&lat2=47.60&lon2=-122.43';
      const swappedRes = await app.request(`/api/v1/visibility-zones/observed/current?${swapped}`);
      const swappedZoneIds = (await jsonBody<{ zoneId: string }[]>(swappedRes)).map((r) => r.zoneId);
      expect(swappedZoneIds).toEqual(intersectingZoneIds);

      const missingRes = await app.request(
        '/api/v1/visibility-zones/observed/current?lat1=0&lon1=0&lat2=1&lon2=1',
      );
      expect(await jsonBody<unknown[]>(missingRes)).toEqual([]);
    });

    test('GET /observed/current rejects a point and an extent together, or neither', async () => {
      const bothRes = await app.request(
        `/api/v1/visibility-zones/observed/current?lat=${pointInside.lat}&lon=${pointInside.lon}&lat1=0&lon1=0&lat2=1&lon2=1`,
      );
      expect(bothRes.status).toBe(400);

      const neitherRes = await app.request('/api/v1/visibility-zones/observed/current');
      expect(neitherRes.status).toBe(400);

      const partialRes = await app.request('/api/v1/visibility-zones/observed/current?lat1=0&lon1=0&lat2=1');
      expect(partialRes.status).toBe(400);
    });

    test('GET /forecast requires at', async () => {
      const res = await app.request('/api/v1/visibility-zones/forecast');
      expect(res.status).toBe(400);
    });

    test('forecast reports resolve to the one closest to the requested at', async () => {
      const near = { reportId: 'it-vfc-near', recordedAt: minutes(240), state: 'cloudy', polygon };
      const far = { reportId: 'it-vfc-far', recordedAt: minutes(360), state: 'stormy', polygon };

      for (const report of [near, far]) {
        const res = await app.request('/api/v1/visibility-zones/it-vis-fresh/forecast-reports', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(report),
        });
        expect(res.status).toBe(201);
      }

      const at = minutes(245);
      const res = await app.request(`/api/v1/visibility-zones/forecast?at=${encodeURIComponent(at)}`);
      const forecasts = await jsonBody<{ zoneId: string; reportId: string }[]>(res);
      const forecastForZone = forecasts.find((f) => f.zoneId === 'it-vis-fresh');
      expect(forecastForZone?.reportId).toBe('it-vfc-near');
    });
  });

  describe('wind zones (smoke test — structurally identical to visibility, minus ceilingFt)', () => {
    test('ingests, lists, and resolves latest', async () => {
      const report = { reportId: 'it-wobs-1', recordedAt: minutes(-5), state: 'heavy_winds', polygon };

      const ingestRes = await app.request('/api/v1/wind-zones/it-wind-1/observed-reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(report),
      });
      expect(ingestRes.status).toBe(201);

      const listRes = await app.request('/api/v1/wind-zones/observed');
      const zoneIds = (await jsonBody<{ zoneId: string }[]>(listRes)).map((r) => r.zoneId);
      expect(zoneIds).toContain('it-wind-1');

      const latestRes = await app.request('/api/v1/wind-zones/it-wind-1/observed-reports/latest');
      expect(latestRes.status).toBe(200);
      expect((await jsonBody<{ state: string }>(latestRes)).state).toBe('heavy_winds');

      const missingRes = await app.request('/api/v1/wind-zones/no-such-zone/observed-reports/latest');
      expect(missingRes.status).toBe(404);
    });

    test('observed/current accepts an extent and rejects a point-and-extent combination', async () => {
      const extentRes = await app.request(
        '/api/v1/wind-zones/observed/current?lat1=47.60&lon1=-122.43&lat2=47.64&lon2=-122.39',
      );
      const zoneIds = (await jsonBody<{ zoneId: string }[]>(extentRes)).map((r) => r.zoneId);
      expect(zoneIds).toContain('it-wind-1');

      const bothRes = await app.request(
        '/api/v1/wind-zones/observed/current?lat=47.62&lon=-122.41&lat1=0&lon1=0&lat2=1&lon2=1',
      );
      expect(bothRes.status).toBe(400);
    });
  });

  describe('sun times', () => {
    test('validation failures return { message } for a missing date', async () => {
      const res = await app.request('/api/v1/sun-times?lat=47.6062&lon=-122.3321');
      expect(res.status).toBe(400);
      const body = await jsonBody<{ message: string }>(res);
      expect(typeof body.message).toBe('string');
    });

    test('returns morning civil twilight, sunrise, sunset, and evening civil twilight in order', async () => {
      const res = await app.request('/api/v1/sun-times?date=2026-07-30&lat=47.6062&lon=-122.3321');
      expect(res.status).toBe(200);
      const body = await jsonBody<{
        morningCivilTwilightBeginsAt: string;
        sunriseAt: string;
        sunsetAt: string;
        eveningCivilTwilightEndsAt: string;
      }>(res);

      const dawn = new Date(body.morningCivilTwilightBeginsAt).getTime();
      const sunrise = new Date(body.sunriseAt).getTime();
      const sunset = new Date(body.sunsetAt).getTime();
      const dusk = new Date(body.eveningCivilTwilightEndsAt).getTime();
      expect(dawn).toBeLessThan(sunrise);
      expect(sunrise).toBeLessThan(sunset);
      expect(sunset).toBeLessThan(dusk);
    });

    test('returns null fields during polar day instead of failing', async () => {
      const res = await app.request('/api/v1/sun-times?date=2026-06-21&lat=78.2232&lon=15.6267');
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        morningCivilTwilightBeginsAt: null,
        sunriseAt: null,
        sunsetAt: null,
        eveningCivilTwilightEndsAt: null,
      });
    });
  });
});
