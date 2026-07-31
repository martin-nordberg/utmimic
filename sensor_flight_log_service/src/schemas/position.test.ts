import { describe, expect, test } from 'bun:test';
import {
  CreatePositionReportSchema,
  CreatePositionReportsBodySchema,
  DroneSerialParamSchema,
  PositionQuerySchema,
} from './position';

const validReport = {
  reportId: 'clh6z9k9x0000qzrm',
  sensorId: 'clh6z8h1x0000qzrm',
  recordedAt: '2026-07-25T14:03:11.000Z',
  latitude: 47.6205,
  longitude: -122.3493,
  altitudeFt: 412.5,
};

describe('CreatePositionReportSchema', () => {
  test('accepts a fully valid report', () => {
    expect(CreatePositionReportSchema.safeParse(validReport).success).toBe(true);
  });

  test('rejects a missing required field', () => {
    const { recordedAt, ...rest } = validReport;
    expect(CreatePositionReportSchema.safeParse(rest).success).toBe(false);
  });

  test('rejects a non-ISO-8601 recordedAt', () => {
    expect(CreatePositionReportSchema.safeParse({ ...validReport, recordedAt: '2026-07-25' }).success).toBe(false);
  });

  test('rejects the wrong type for a numeric field', () => {
    expect(CreatePositionReportSchema.safeParse({ ...validReport, altitudeFt: 'high' }).success).toBe(false);
  });

  test('rejects a latitude of exactly 90 or -90 (exclusive)', () => {
    expect(CreatePositionReportSchema.safeParse({ ...validReport, latitude: 90 }).success).toBe(false);
    expect(CreatePositionReportSchema.safeParse({ ...validReport, latitude: -90 }).success).toBe(false);
  });

  test('accepts a longitude of exactly 180 or -180 (inclusive)', () => {
    expect(CreatePositionReportSchema.safeParse({ ...validReport, longitude: 180 }).success).toBe(true);
    expect(CreatePositionReportSchema.safeParse({ ...validReport, longitude: -180 }).success).toBe(true);
  });

  test('rejects a longitude beyond ±180', () => {
    expect(CreatePositionReportSchema.safeParse({ ...validReport, longitude: 200 }).success).toBe(false);
  });
});

describe('CreatePositionReportsBodySchema', () => {
  test('accepts a single report object', () => {
    expect(CreatePositionReportsBodySchema.safeParse(validReport).success).toBe(true);
  });

  test('accepts an array of reports', () => {
    expect(CreatePositionReportsBodySchema.safeParse([validReport, validReport]).success).toBe(true);
  });

  test('accepts an empty array', () => {
    expect(CreatePositionReportsBodySchema.safeParse([]).success).toBe(true);
  });

  test('rejects an array containing an invalid report', () => {
    const invalid = { ...validReport, latitude: 'north' };
    expect(CreatePositionReportsBodySchema.safeParse([validReport, invalid]).success).toBe(false);
  });
});

describe('PositionQuerySchema', () => {
  test('accepts no query params', () => {
    expect(PositionQuerySchema.safeParse({}).success).toBe(true);
  });

  test('coerces a numeric limit string', () => {
    const result = PositionQuerySchema.safeParse({ limit: '100' });
    expect(result.success).toBe(true);
    expect(result.success && result.data.limit).toBe(100);
  });

  test('rejects a non-numeric limit', () => {
    expect(PositionQuerySchema.safeParse({ limit: 'all' }).success).toBe(false);
  });

  test('rejects a non-ISO-8601 from', () => {
    expect(PositionQuerySchema.safeParse({ from: 'yesterday' }).success).toBe(false);
  });
});

describe('DroneSerialParamSchema', () => {
  test('rejects an empty serial', () => {
    expect(DroneSerialParamSchema.safeParse({ serial: '' }).success).toBe(false);
  });
});
