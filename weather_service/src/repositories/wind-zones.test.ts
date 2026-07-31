import { beforeAll, describe, expect, test } from 'bun:test';
import { sql } from '../db';
import type { Polygon } from '../schemas/geojson';
import { resetSchema } from '../test-support/reset-db';
import { insertObservedReports, type WindReportInput } from './wind-zones';

const polygon: Polygon = {
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

// Doesn't close `sql` in an afterAll: it's a module-level singleton shared with
// integration.test.ts (and visibility-zones.test.ts) across this whole test run, and closing it
// here would break whichever of those files happens to run afterward.
beforeAll(async () => {
  await resetSchema();
});

describe('insertObservedReports', () => {
  test('rolls back the whole batch when a later report fails a DB constraint, instead of leaving earlier ones committed', async () => {
    const zoneId = 'rt-wind-zone-1';
    const good: WindReportInput = {
      reportId: 'rt-wind-good-1',
      recordedAt: '2026-08-01T00:00:00.000Z',
      state: 'calm',
      polygon,
    };
    // A state value the table's CHECK constraint rejects but that Zod would normally have
    // already blocked at the HTTP layer — bypassing the type system here to reach this
    // repository function directly, the same way a schema-drifted caller eventually might.
    const bad = {
      reportId: 'rt-wind-bad-1',
      recordedAt: '2026-08-01T00:01:00.000Z',
      state: 'not-a-real-state',
      polygon,
    } as unknown as WindReportInput;

    await expect(insertObservedReports(zoneId, [good, bad])).rejects.toThrow();

    const rows = await sql<{ report_id: string }[]>`
      SELECT report_id FROM weather.wind_observed_reports WHERE zone_id = ${zoneId}
    `;
    expect(rows.length).toBe(0);
  });
});
