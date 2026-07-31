import { beforeAll, describe, expect, test } from 'bun:test';
import { app } from './app';
import { config } from './config';
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

// Doesn't close `sql` in an afterAll: it's a module-level singleton shared with the
// repository-level test files (visibility-zones.test.ts, wind-zones.test.ts) across this whole
// test run, and closing it here would break whichever of those happens to run afterward. Bun's
// test runner exits cleanly regardless of the still-open pool.
beforeAll(async () => {
  await resetSchema();
});

describe('weather_service (end-to-end)', () => {
  test('rejects a body-carrying request with the wrong Content-Type', async () => {
    const res = await app.request('/api/v1/visibility-zones/IT-ZONE/observed-reports', {
      method: 'POST',
      body: JSON.stringify({ reportId: 'wrong-content-type', recordedAt: minutes(0), state: 'clear', polygon }),
    });
    expect(res.status).toBe(415);
  });

  test('rejects syntactically-broken JSON with a { message } JSON body, not a plain-text one', async () => {
    const res = await app.request('/api/v1/visibility-zones/IT-ZONE/observed-reports', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{not valid json',
    });
    expect(res.status).toBe(400);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(await jsonBody<{ message: string }>(res)).toEqual({ message: 'Malformed JSON in request body' });
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

    test('GET /observed/current rejects an out-of-range point and a zero-area extent', async () => {
      const outOfRangeRes = await app.request('/api/v1/visibility-zones/observed/current?lat=90&lon=0');
      expect(outOfRangeRes.status).toBe(400);

      const zeroAreaRes = await app.request(
        '/api/v1/visibility-zones/observed/current?lat1=47.6&lon1=-122.4&lat2=47.6&lon2=-122.4',
      );
      expect(zeroAreaRes.status).toBe(400);
    });

    test('POST .../observed-reports rejects a polygon with an out-of-range vertex', async () => {
      const badPolygon = { ...polygon, coordinates: [[...polygon.coordinates[0]!, [200, 47.61]]] };
      const res = await app.request('/api/v1/visibility-zones/it-vis-bad-polygon/observed-reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reportId: 'it-vobs-bad-polygon', recordedAt: minutes(-5), state: 'clear', polygon: badPolygon }),
      });
      expect(res.status).toBe(400);
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

    test('GET /{zoneId}/observed-reports supports from/to/limit range filtering and an at instant', async () => {
      const zoneId = 'it-vis-history';
      const reports = [
        { reportId: 'it-vobs-hist-1', recordedAt: minutes(-30), state: 'clear', polygon },
        { reportId: 'it-vobs-hist-2', recordedAt: minutes(-20), state: 'cloudy', polygon },
        { reportId: 'it-vobs-hist-3', recordedAt: minutes(-10), state: 'rainy', polygon },
      ];
      for (const report of reports) {
        const res = await app.request(`/api/v1/visibility-zones/${zoneId}/observed-reports`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(report),
        });
        expect(res.status).toBe(201);
      }

      const all = await app.request(`/api/v1/visibility-zones/${zoneId}/observed-reports`);
      expect(all.status).toBe(200);
      const allIds = (await jsonBody<{ reportId: string }[]>(all)).map((r) => r.reportId);
      expect(allIds).toEqual(['it-vobs-hist-1', 'it-vobs-hist-2', 'it-vobs-hist-3']);

      const fromOnly = await app.request(
        `/api/v1/visibility-zones/${zoneId}/observed-reports?from=${encodeURIComponent(minutes(-25))}`,
      );
      const fromIds = (await jsonBody<{ reportId: string }[]>(fromOnly)).map((r) => r.reportId);
      expect(fromIds).toEqual(['it-vobs-hist-2', 'it-vobs-hist-3']);

      const toOnly = await app.request(
        `/api/v1/visibility-zones/${zoneId}/observed-reports?to=${encodeURIComponent(minutes(-15))}`,
      );
      const toIds = (await jsonBody<{ reportId: string }[]>(toOnly)).map((r) => r.reportId);
      expect(toIds).toEqual(['it-vobs-hist-1', 'it-vobs-hist-2']);

      const fromAndTo = await app.request(
        `/api/v1/visibility-zones/${zoneId}/observed-reports?from=${encodeURIComponent(minutes(-25))}&to=${encodeURIComponent(minutes(-15))}`,
      );
      const fromAndToIds = (await jsonBody<{ reportId: string }[]>(fromAndTo)).map((r) => r.reportId);
      expect(fromAndToIds).toEqual(['it-vobs-hist-2']);

      const limited = await app.request(`/api/v1/visibility-zones/${zoneId}/observed-reports?limit=1`);
      const limitedIds = (await jsonBody<{ reportId: string }[]>(limited)).map((r) => r.reportId);
      expect(limitedIds).toEqual(['it-vobs-hist-1']);

      // at= resolves the most recent report at-or-before that instant, not the closest overall.
      const atInstant = await app.request(
        `/api/v1/visibility-zones/${zoneId}/observed-reports?at=${encodeURIComponent(minutes(-15))}`,
      );
      const atIds = (await jsonBody<{ reportId: string }[]>(atInstant)).map((r) => r.reportId);
      expect(atIds).toEqual(['it-vobs-hist-2']);
    });

    test('GET /{zoneId}/forecast-reports supports from/to/limit range filtering and an at instant (closest match)', async () => {
      const zoneId = 'it-vis-history';
      const forecasts = [
        { reportId: 'it-vfc-hist-1', recordedAt: minutes(60), state: 'clear', polygon },
        { reportId: 'it-vfc-hist-2', recordedAt: minutes(120), state: 'cloudy', polygon },
        { reportId: 'it-vfc-hist-3', recordedAt: minutes(180), state: 'rainy', polygon },
      ];
      for (const report of forecasts) {
        const res = await app.request(`/api/v1/visibility-zones/${zoneId}/forecast-reports`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(report),
        });
        expect(res.status).toBe(201);
      }

      const all = await app.request(`/api/v1/visibility-zones/${zoneId}/forecast-reports`);
      expect(all.status).toBe(200);
      const allIds = (await jsonBody<{ reportId: string }[]>(all)).map((r) => r.reportId);
      expect(allIds).toEqual(['it-vfc-hist-1', 'it-vfc-hist-2', 'it-vfc-hist-3']);

      const limited = await app.request(`/api/v1/visibility-zones/${zoneId}/forecast-reports?limit=2`);
      const limitedIds = (await jsonBody<{ reportId: string }[]>(limited)).map((r) => r.reportId);
      expect(limitedIds).toEqual(['it-vfc-hist-1', 'it-vfc-hist-2']);

      // Closest to minutes(130) is minutes(120) (10 min away) over minutes(180) (50 min away) —
      // unlike observed history's at=, this isn't an at-or-before cutoff.
      const closest = await app.request(
        `/api/v1/visibility-zones/${zoneId}/forecast-reports?at=${encodeURIComponent(minutes(130))}`,
      );
      const closestIds = (await jsonBody<{ reportId: string }[]>(closest)).map((r) => r.reportId);
      expect(closestIds).toEqual(['it-vfc-hist-2']);
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
