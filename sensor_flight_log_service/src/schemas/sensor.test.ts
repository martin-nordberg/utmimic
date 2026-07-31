import { describe, expect, test } from 'bun:test';
import { CreateSensorSchema, SensorIdParamSchema, UpdateSensorSchema } from './sensor';

const validCreate = {
  sensorId: 'clh6z8h1x0000qzrm',
  name: 'West Ridge',
  notes: 'Mast-mounted, north side of the ridge',
  latitude: 47.63,
  longitude: -122.36,
  sensingRadiusMeters: 5000,
  status: 'online',
};

describe('CreateSensorSchema', () => {
  test('accepts a fully valid sensor', () => {
    expect(CreateSensorSchema.safeParse(validCreate).success).toBe(true);
  });

  test('defaults status to offline when omitted', () => {
    const { status, ...rest } = validCreate;
    const result = CreateSensorSchema.safeParse(rest);
    expect(result.success).toBe(true);
    expect(result.success && result.data.status).toBe('offline');
  });

  test('rejects a missing required field', () => {
    const { name, ...rest } = validCreate;
    expect(CreateSensorSchema.safeParse(rest).success).toBe(false);
  });

  test('rejects the wrong type for a numeric field', () => {
    expect(CreateSensorSchema.safeParse({ ...validCreate, latitude: 'north' }).success).toBe(false);
  });

  test('rejects a non-positive sensingRadiusMeters', () => {
    expect(CreateSensorSchema.safeParse({ ...validCreate, sensingRadiusMeters: 0 }).success).toBe(false);
  });

  test('rejects an invalid status value', () => {
    expect(CreateSensorSchema.safeParse({ ...validCreate, status: 'unknown' }).success).toBe(false);
  });

  test('rejects a latitude of exactly 90 or -90 (exclusive)', () => {
    expect(CreateSensorSchema.safeParse({ ...validCreate, latitude: 90 }).success).toBe(false);
    expect(CreateSensorSchema.safeParse({ ...validCreate, latitude: -90 }).success).toBe(false);
  });

  test('rejects a latitude beyond ±90', () => {
    expect(CreateSensorSchema.safeParse({ ...validCreate, latitude: 999 }).success).toBe(false);
  });

  test('accepts a longitude of exactly 180 or -180 (inclusive)', () => {
    expect(CreateSensorSchema.safeParse({ ...validCreate, longitude: 180 }).success).toBe(true);
    expect(CreateSensorSchema.safeParse({ ...validCreate, longitude: -180 }).success).toBe(true);
  });

  test('rejects a longitude beyond ±180', () => {
    expect(CreateSensorSchema.safeParse({ ...validCreate, longitude: -5000 }).success).toBe(false);
  });
});

describe('UpdateSensorSchema', () => {
  test('accepts an empty patch', () => {
    expect(UpdateSensorSchema.safeParse({}).success).toBe(true);
  });

  test('accepts a partial patch with a single field', () => {
    expect(UpdateSensorSchema.safeParse({ status: 'offline' }).success).toBe(true);
  });

  test('rejects an invalid status value', () => {
    expect(UpdateSensorSchema.safeParse({ status: 'unplugged' }).success).toBe(false);
  });

  test('rejects the wrong type for a numeric field', () => {
    expect(UpdateSensorSchema.safeParse({ sensingRadiusMeters: 'wide' }).success).toBe(false);
  });

  test('rejects an out-of-range latitude/longitude', () => {
    expect(UpdateSensorSchema.safeParse({ latitude: 90 }).success).toBe(false);
    expect(UpdateSensorSchema.safeParse({ longitude: 181 }).success).toBe(false);
  });
});

describe('SensorIdParamSchema', () => {
  test('accepts a non-empty sensorId', () => {
    expect(SensorIdParamSchema.safeParse({ sensorId: 'clh6z8h1x0000qzrm' }).success).toBe(true);
  });

  test('rejects an empty sensorId', () => {
    expect(SensorIdParamSchema.safeParse({ sensorId: '' }).success).toBe(false);
  });
});
