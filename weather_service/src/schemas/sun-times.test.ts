import { describe, expect, test } from 'bun:test';
import { SunTimesQuerySchema } from './sun-times';

describe('SunTimesQuerySchema', () => {
  test('accepts a valid date/lat/lon', () => {
    const result = SunTimesQuerySchema.safeParse({ date: '2026-07-30', lat: '47.6062', lon: '-122.3321' });
    expect(result.success).toBe(true);
    expect(result.success && result.data).toEqual({ date: '2026-07-30', lat: 47.6062, lon: -122.3321 });
  });

  test('rejects a non-YYYY-MM-DD date', () => {
    expect(SunTimesQuerySchema.safeParse({ date: 'not-a-date', lat: '47.6', lon: '-122.3' }).success).toBe(false);
  });

  test('rejects a full datetime where only a date is expected', () => {
    expect(
      SunTimesQuerySchema.safeParse({ date: '2026-07-30T00:00:00.000Z', lat: '47.6', lon: '-122.3' }).success,
    ).toBe(false);
  });

  test('rejects a missing lat', () => {
    expect(SunTimesQuerySchema.safeParse({ date: '2026-07-30', lon: '-122.3' }).success).toBe(false);
  });

  test('rejects a non-numeric lon', () => {
    expect(SunTimesQuerySchema.safeParse({ date: '2026-07-30', lat: '47.6', lon: 'west' }).success).toBe(false);
  });

  test('rejects a latitude of exactly 90 or -90 (exclusive)', () => {
    expect(SunTimesQuerySchema.safeParse({ date: '2026-07-30', lat: '90', lon: '0' }).success).toBe(false);
    expect(SunTimesQuerySchema.safeParse({ date: '2026-07-30', lat: '-90', lon: '0' }).success).toBe(false);
  });

  test('accepts a longitude of exactly 180 or -180 (inclusive)', () => {
    expect(SunTimesQuerySchema.safeParse({ date: '2026-07-30', lat: '0', lon: '180' }).success).toBe(true);
    expect(SunTimesQuerySchema.safeParse({ date: '2026-07-30', lat: '0', lon: '-180' }).success).toBe(true);
  });

  test('rejects a longitude beyond 180 or -180', () => {
    expect(SunTimesQuerySchema.safeParse({ date: '2026-07-30', lat: '0', lon: '180.5' }).success).toBe(false);
  });
});
