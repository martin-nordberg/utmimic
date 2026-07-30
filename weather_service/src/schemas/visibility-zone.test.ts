import { describe, expect, test } from 'bun:test';
import {
  CreateVisibilityReportSchema,
  CreateVisibilityReportsBodySchema,
  VisibilityForecastCurrentQuerySchema,
  VisibilityForecastQuerySchema,
  VisibilityHistoryQuerySchema,
  VisibilityObservedCurrentQuerySchema,
  VisibilityZoneIdParamSchema,
} from './visibility-zone';

const polygon = {
  type: 'Polygon' as const,
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

const validReport = {
  reportId: 'clh6z9k9x0000qzrm',
  recordedAt: '2026-07-25T14:03:11.000Z',
  state: 'clear',
  polygon,
};

describe('CreateVisibilityReportSchema', () => {
  test('accepts a valid non-foggy report with no ceilingFt', () => {
    expect(CreateVisibilityReportSchema.safeParse(validReport).success).toBe(true);
  });

  test('accepts a foggy report with ceilingFt', () => {
    expect(CreateVisibilityReportSchema.safeParse({ ...validReport, state: 'foggy', ceilingFt: 800 }).success).toBe(
      true,
    );
  });

  test('rejects a foggy report missing ceilingFt', () => {
    expect(CreateVisibilityReportSchema.safeParse({ ...validReport, state: 'foggy' }).success).toBe(false);
  });

  test('rejects a non-foggy report that sets ceilingFt', () => {
    expect(CreateVisibilityReportSchema.safeParse({ ...validReport, ceilingFt: 800 }).success).toBe(false);
  });

  test('rejects an invalid state value', () => {
    expect(CreateVisibilityReportSchema.safeParse({ ...validReport, state: 'sunny' }).success).toBe(false);
  });

  test('rejects a missing required field', () => {
    const { recordedAt, ...rest } = validReport;
    expect(CreateVisibilityReportSchema.safeParse(rest).success).toBe(false);
  });

  test('rejects a malformed polygon', () => {
    expect(CreateVisibilityReportSchema.safeParse({ ...validReport, polygon: { type: 'Point' } }).success).toBe(
      false,
    );
  });
});

describe('CreateVisibilityReportsBodySchema', () => {
  test('accepts a single report object', () => {
    expect(CreateVisibilityReportsBodySchema.safeParse(validReport).success).toBe(true);
  });

  test('accepts an array of reports', () => {
    expect(CreateVisibilityReportsBodySchema.safeParse([validReport, validReport]).success).toBe(true);
  });

  test('accepts an empty array', () => {
    expect(CreateVisibilityReportsBodySchema.safeParse([]).success).toBe(true);
  });

  test('rejects an array containing an invalid report', () => {
    const invalid = { ...validReport, state: 'foggy' };
    expect(CreateVisibilityReportsBodySchema.safeParse([validReport, invalid]).success).toBe(false);
  });
});

describe('VisibilityZoneIdParamSchema', () => {
  test('rejects an empty zoneId', () => {
    expect(VisibilityZoneIdParamSchema.safeParse({ zoneId: '' }).success).toBe(false);
  });
});

describe('VisibilityHistoryQuerySchema', () => {
  test('accepts no query params', () => {
    expect(VisibilityHistoryQuerySchema.safeParse({}).success).toBe(true);
  });

  test('coerces a numeric limit string', () => {
    const result = VisibilityHistoryQuerySchema.safeParse({ limit: '100' });
    expect(result.success).toBe(true);
    expect(result.success && result.data.limit).toBe(100);
  });

  test('rejects a non-ISO-8601 at', () => {
    expect(VisibilityHistoryQuerySchema.safeParse({ at: 'yesterday' }).success).toBe(false);
  });
});

describe('VisibilityForecastQuerySchema', () => {
  test('requires at', () => {
    expect(VisibilityForecastQuerySchema.safeParse({}).success).toBe(false);
  });

  test('accepts a valid at', () => {
    expect(VisibilityForecastQuerySchema.safeParse({ at: '2026-07-25T18:00:00.000Z' }).success).toBe(true);
  });
});

describe('VisibilityObservedCurrentQuerySchema', () => {
  test('accepts lat/lon with no at', () => {
    const result = VisibilityObservedCurrentQuerySchema.safeParse({ lat: '47.62', lon: '-122.35' });
    expect(result.success).toBe(true);
    expect(result.success && result.data).toEqual({ lat: 47.62, lon: -122.35 });
  });

  test('rejects a missing lat', () => {
    expect(VisibilityObservedCurrentQuerySchema.safeParse({ lon: '-122.35' }).success).toBe(false);
  });
});

describe('VisibilityForecastCurrentQuerySchema', () => {
  test('rejects lat/lon with no at', () => {
    expect(VisibilityForecastCurrentQuerySchema.safeParse({ lat: '47.62', lon: '-122.35' }).success).toBe(false);
  });

  test('accepts lat/lon with at', () => {
    const result = VisibilityForecastCurrentQuerySchema.safeParse({
      lat: '47.62',
      lon: '-122.35',
      at: '2026-07-25T18:00:00.000Z',
    });
    expect(result.success).toBe(true);
  });
});
