import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { app } from './app';
import { sql } from './db';
import { resetSchema } from './test-support/reset-db';

const sensorId = 'it-sensor-1';
const serial = 'IT-DRONE-1';

async function jsonBody<T = Record<string, unknown>>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

beforeAll(async () => {
  await resetSchema();
});

afterAll(async () => {
  await sql.close();
});

describe('sensor flight log service (end-to-end)', () => {
  test('registers a sensor', async () => {
    const res = await app.request('/api/v1/sensors', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sensorId,
        name: 'Integration Test Sensor',
        latitude: 47.63,
        longitude: -122.36,
        sensingRadiusMeters: 5000,
        status: 'online',
      }),
    });
    expect(res.status).toBe(201);
    const body = await jsonBody(res);
    expect(body.sensorId).toBe(sensorId);
  });

  test('rejects registering the same sensorId twice', async () => {
    const res = await app.request('/api/v1/sensors', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sensorId,
        name: 'Duplicate',
        latitude: 0,
        longitude: 0,
        sensingRadiusMeters: 1,
      }),
    });
    expect(res.status).toBe(409);
  });

  test('404s fetching an unknown sensor', async () => {
    const res = await app.request('/api/v1/sensors/no-such-sensor');
    expect(res.status).toBe(404);
  });

  test('partially updates a sensor', async () => {
    const res = await app.request(`/api/v1/sensors/${sensorId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'offline' }),
    });
    expect(res.status).toBe(200);
    const body = await jsonBody(res);
    expect(body.status).toBe('offline');
    expect(body.name).toBe('Integration Test Sensor');
  });

  test('sets and fetches a sensor profile', async () => {
    const putRes = await app.request(`/api/v1/sensors/${sensorId}/profile`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pollIntervalMs: { min: 2000, max: 5000 } }),
    });
    expect(putRes.status).toBe(200);

    const getRes = await app.request(`/api/v1/sensors/${sensorId}/profile`);
    expect(getRes.status).toBe(200);
    const body = await jsonBody(getRes);
    expect(body.profile).toEqual({ pollIntervalMs: { min: 2000, max: 5000 } });
  });

  test('rejects a profile for an unknown sensor', async () => {
    const res = await app.request('/api/v1/sensors/no-such-sensor/profile', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ a: 1 }),
    });
    expect(res.status).toBe(404);
  });

  test('ingests position reports and queries them back', async () => {
    const reports = [
      {
        reportId: 'it-r1',
        sensorId,
        recordedAt: '2026-07-25T14:03:11.000Z',
        latitude: 47.6205,
        longitude: -122.3493,
        altitudeFt: 412.5,
      },
      {
        reportId: 'it-r2',
        sensorId,
        recordedAt: '2026-07-25T14:03:12.000Z',
        latitude: 47.6206,
        longitude: -122.3494,
        altitudeFt: 413,
      },
    ];

    const ingestRes = await app.request(`/api/v1/drones/${serial}/positions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(reports),
    });
    expect(ingestRes.status).toBe(201);
    expect(await ingestRes.json()).toHaveLength(2);

    const retryRes = await app.request(`/api/v1/drones/${serial}/positions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(reports),
    });
    expect(retryRes.status).toBe(201);
    expect(await retryRes.json()).toHaveLength(0);

    const listRes = await app.request(`/api/v1/drones/${serial}/positions`);
    expect(listRes.status).toBe(200);
    const list = (await listRes.json()) as { reportId: string }[];
    expect(list.map((r) => r.reportId)).toEqual(['it-r1', 'it-r2']);

    const latestRes = await app.request(`/api/v1/drones/${serial}/positions/latest`);
    expect(latestRes.status).toBe(200);
    expect((await jsonBody<{ reportId: string }>(latestRes)).reportId).toBe('it-r2');
  });

  test('rejects ingest for an unknown sensorId', async () => {
    const res = await app.request(`/api/v1/drones/${serial}/positions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        reportId: 'it-r3',
        sensorId: 'no-such-sensor',
        recordedAt: '2026-07-25T14:03:13.000Z',
        latitude: 1,
        longitude: 1,
        altitudeFt: 1,
      }),
    });
    expect(res.status).toBe(404);
  });

  test('accepts an empty array ingest as a no-op', async () => {
    const res = await app.request(`/api/v1/drones/${serial}/positions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify([]),
    });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual([]);
  });

  test('404s for /latest on a drone with no positions', async () => {
    const res = await app.request('/api/v1/drones/NO-SUCH-DRONE/positions/latest');
    expect(res.status).toBe(404);
  });

  test('removes the sensor profile', async () => {
    const res = await app.request(`/api/v1/sensors/${sensorId}/profile`, { method: 'DELETE' });
    expect(res.status).toBe(204);

    const getRes = await app.request(`/api/v1/sensors/${sensorId}/profile`);
    expect(getRes.status).toBe(404);
  });
});
