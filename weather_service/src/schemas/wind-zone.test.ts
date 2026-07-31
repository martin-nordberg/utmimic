import { describe, expect, test } from 'bun:test';
import {
  CreateWindReportSchema,
  CreateWindReportsBodySchema,
  WindForecastCurrentQuerySchema,
  WindForecastQuerySchema,
  WindHistoryQuerySchema,
  WindObservedCurrentQuerySchema,
  WindZoneIdParamSchema,
} from './wind-zone';

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
  state: 'calm',
  polygon,
};

describe('CreateWindReportSchema', () => {
  test('accepts a valid report', () => {
    expect(CreateWindReportSchema.safeParse(validReport).success).toBe(true);
  });

  test('accepts every wind state value', () => {
    for (const state of ['calm', 'slight_winds', 'heavy_winds', 'dangerous_winds']) {
      expect(CreateWindReportSchema.safeParse({ ...validReport, state }).success).toBe(true);
    }
  });

  test('rejects an invalid state value', () => {
    expect(CreateWindReportSchema.safeParse({ ...validReport, state: 'hurricane' }).success).toBe(false);
  });

  test('rejects a missing required field', () => {
    const { recordedAt, ...rest } = validReport;
    expect(CreateWindReportSchema.safeParse(rest).success).toBe(false);
  });

  test('rejects a malformed polygon', () => {
    expect(CreateWindReportSchema.safeParse({ ...validReport, polygon: { type: 'Point' } }).success).toBe(false);
  });

  // Inserts an extra vertex just before the ring's closing point, so the ring stays closed
  // (first === last) and only the inserted vertex's range is under test.
  function withExtraVertex(vertex: [number, number]) {
    const ring = polygon.coordinates[0]!;
    return { ...polygon, coordinates: [[...ring.slice(0, -1), vertex, ring[ring.length - 1]!]] };
  }

  test('rejects a polygon vertex with an out-of-range latitude', () => {
    const badPolygon = withExtraVertex([-122.42, 90]);
    expect(CreateWindReportSchema.safeParse({ ...validReport, polygon: badPolygon }).success).toBe(false);
  });

  test('rejects a polygon vertex with an out-of-range longitude', () => {
    const badPolygon = withExtraVertex([180.001, 47.61]);
    expect(CreateWindReportSchema.safeParse({ ...validReport, polygon: badPolygon }).success).toBe(false);
  });

  test('accepts a polygon vertex at the longitude boundary (inclusive)', () => {
    const boundaryPolygon = withExtraVertex([180, 47.61]);
    expect(CreateWindReportSchema.safeParse({ ...validReport, polygon: boundaryPolygon }).success).toBe(true);
  });
});

describe('CreateWindReportsBodySchema', () => {
  test('accepts a single report object', () => {
    expect(CreateWindReportsBodySchema.safeParse(validReport).success).toBe(true);
  });

  test('accepts an array of reports', () => {
    expect(CreateWindReportsBodySchema.safeParse([validReport, validReport]).success).toBe(true);
  });

  test('accepts an empty array', () => {
    expect(CreateWindReportsBodySchema.safeParse([]).success).toBe(true);
  });

  test('rejects an array containing an invalid report', () => {
    const invalid = { ...validReport, state: 'hurricane' };
    expect(CreateWindReportsBodySchema.safeParse([validReport, invalid]).success).toBe(false);
  });
});

describe('WindZoneIdParamSchema', () => {
  test('rejects an empty zoneId', () => {
    expect(WindZoneIdParamSchema.safeParse({ zoneId: '' }).success).toBe(false);
  });
});

describe('WindHistoryQuerySchema', () => {
  test('accepts no query params', () => {
    expect(WindHistoryQuerySchema.safeParse({}).success).toBe(true);
  });

  test('coerces a numeric limit string', () => {
    const result = WindHistoryQuerySchema.safeParse({ limit: '100' });
    expect(result.success).toBe(true);
    expect(result.success && result.data.limit).toBe(100);
  });

  test('rejects a non-ISO-8601 at', () => {
    expect(WindHistoryQuerySchema.safeParse({ at: 'yesterday' }).success).toBe(false);
  });
});

describe('WindForecastQuerySchema', () => {
  test('requires at', () => {
    expect(WindForecastQuerySchema.safeParse({}).success).toBe(false);
  });

  test('accepts a valid at', () => {
    expect(WindForecastQuerySchema.safeParse({ at: '2026-07-25T18:00:00.000Z' }).success).toBe(true);
  });
});

describe('WindObservedCurrentQuerySchema', () => {
  test('accepts lat/lon with no at', () => {
    const result = WindObservedCurrentQuerySchema.safeParse({ lat: '47.62', lon: '-122.35' });
    expect(result.success).toBe(true);
    expect(result.success && result.data).toEqual({ lat: 47.62, lon: -122.35 });
  });

  test('rejects a missing lat', () => {
    expect(WindObservedCurrentQuerySchema.safeParse({ lon: '-122.35' }).success).toBe(false);
  });

  test('accepts a complete extent with no point', () => {
    const result = WindObservedCurrentQuerySchema.safeParse({
      lat1: '47.55',
      lon1: '-122.45',
      lat2: '47.70',
      lon2: '-122.25',
    });
    expect(result.success).toBe(true);
    expect(result.success && result.data).toEqual({ lat1: 47.55, lon1: -122.45, lat2: 47.7, lon2: -122.25 });
  });

  test('rejects both a point and an extent', () => {
    const result = WindObservedCurrentQuerySchema.safeParse({
      lat: '47.62',
      lon: '-122.35',
      lat1: '47.55',
      lon1: '-122.45',
      lat2: '47.70',
      lon2: '-122.25',
    });
    expect(result.success).toBe(false);
  });

  test('rejects a partial extent (missing lon2)', () => {
    const result = WindObservedCurrentQuerySchema.safeParse({ lat1: '47.55', lon1: '-122.45', lat2: '47.70' });
    expect(result.success).toBe(false);
  });

  test('rejects neither a point nor an extent', () => {
    expect(WindObservedCurrentQuerySchema.safeParse({}).success).toBe(false);
  });

  test('rejects a latitude of exactly 90 or -90 (exclusive)', () => {
    expect(WindObservedCurrentQuerySchema.safeParse({ lat: '90', lon: '0' }).success).toBe(false);
    expect(WindObservedCurrentQuerySchema.safeParse({ lat: '-90', lon: '0' }).success).toBe(false);
  });

  test('accepts a latitude just short of the poles', () => {
    expect(WindObservedCurrentQuerySchema.safeParse({ lat: '89.999', lon: '0' }).success).toBe(true);
  });

  test('accepts a longitude of exactly 180 or -180 (inclusive)', () => {
    expect(WindObservedCurrentQuerySchema.safeParse({ lat: '0', lon: '180' }).success).toBe(true);
    expect(WindObservedCurrentQuerySchema.safeParse({ lat: '0', lon: '-180' }).success).toBe(true);
  });

  test('rejects a longitude beyond 180 or -180', () => {
    expect(WindObservedCurrentQuerySchema.safeParse({ lat: '0', lon: '180.001' }).success).toBe(false);
    expect(WindObservedCurrentQuerySchema.safeParse({ lat: '0', lon: '-180.001' }).success).toBe(false);
  });

  test('rejects an extent with zero height (lat1 === lat2)', () => {
    const result = WindObservedCurrentQuerySchema.safeParse({ lat1: '47.6', lon1: '-122.5', lat2: '47.6', lon2: '-122.3' });
    expect(result.success).toBe(false);
  });

  test('rejects an extent with zero width (lon1 === lon2)', () => {
    const result = WindObservedCurrentQuerySchema.safeParse({ lat1: '47.5', lon1: '-122.4', lat2: '47.7', lon2: '-122.4' });
    expect(result.success).toBe(false);
  });

  test('rejects a degenerate point-like extent (both zero width and height)', () => {
    const result = WindObservedCurrentQuerySchema.safeParse({ lat1: '47.6', lon1: '-122.4', lat2: '47.6', lon2: '-122.4' });
    expect(result.success).toBe(false);
  });
});

describe('WindForecastCurrentQuerySchema', () => {
  test('rejects lat/lon with no at', () => {
    expect(WindForecastCurrentQuerySchema.safeParse({ lat: '47.62', lon: '-122.35' }).success).toBe(false);
  });

  test('accepts lat/lon with at', () => {
    const result = WindForecastCurrentQuerySchema.safeParse({
      lat: '47.62',
      lon: '-122.35',
      at: '2026-07-25T18:00:00.000Z',
    });
    expect(result.success).toBe(true);
  });

  test('accepts an extent with at', () => {
    const result = WindForecastCurrentQuerySchema.safeParse({
      lat1: '47.55',
      lon1: '-122.45',
      lat2: '47.70',
      lon2: '-122.25',
      at: '2026-07-25T18:00:00.000Z',
    });
    expect(result.success).toBe(true);
  });

  test('rejects an extent with no at', () => {
    const result = WindForecastCurrentQuerySchema.safeParse({
      lat1: '47.55',
      lon1: '-122.45',
      lat2: '47.70',
      lon2: '-122.25',
    });
    expect(result.success).toBe(false);
  });
});
