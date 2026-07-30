import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { app } from './app';
import { sql } from './db';
import { resetSchema } from './test-support/reset-db';

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

describe('live flight log service (end-to-end)', () => {
  test('rejects a body-carrying request with the wrong Content-Type', async () => {
    const res = await app.request(`/api/v1/drones/${serial}/positions`, {
      method: 'POST',
      body: JSON.stringify({
        reportId: 'wrong-content-type-report',
        recordedAt: '2026-07-25T14:03:11.000Z',
        latitude: 1,
        longitude: 1,
        altitudeFt: 1,
      }),
    });
    expect(res.status).toBe(415);
  });

  test('rejects syntactically-broken JSON with a { message } JSON body, not a plain-text one', async () => {
    const res = await app.request(`/api/v1/drones/${serial}/positions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{not valid json',
    });
    expect(res.status).toBe(400);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(await jsonBody<{ message: string }>(res)).toEqual({ message: 'Malformed JSON in request body' });
  });

  test('validation failures return { message } like every other error, not the default ZodError shape', async () => {
    const res = await app.request(`/api/v1/drones/${serial}/positions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recordedAt: '2026-07-25T14:03:11.000Z' }),
    });
    expect(res.status).toBe(400);
    const body = await jsonBody<{ message: string }>(res);
    expect(typeof body.message).toBe('string');
    expect(body).not.toHaveProperty('success');
    expect(body).not.toHaveProperty('error');
  });

  test('ingests position reports and queries them back', async () => {
    const reports = [
      {
        reportId: 'it-r1',
        recordedAt: '2026-07-25T14:03:11.000Z',
        latitude: 47.6205,
        longitude: -122.3493,
        altitudeFt: 412.5,
      },
      {
        reportId: 'it-r2',
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
});
