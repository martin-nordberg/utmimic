import { describe, expect, test } from 'bun:test';
import { PolygonSchema } from './geojson';

const validPolygon = {
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

describe('PolygonSchema', () => {
  test('accepts a valid polygon', () => {
    expect(PolygonSchema.safeParse(validPolygon).success).toBe(true);
  });

  test('rejects a non-Polygon type', () => {
    expect(PolygonSchema.safeParse({ ...validPolygon, type: 'Point' }).success).toBe(false);
  });

  test('rejects a ring point with only one coordinate', () => {
    const invalid = { ...validPolygon, coordinates: [[[-122.42], [-122.4, 47.61]]] };
    expect(PolygonSchema.safeParse(invalid).success).toBe(false);
  });

  test('rejects non-numeric coordinates', () => {
    const invalid = { ...validPolygon, coordinates: [[['north', 47.61]]] };
    expect(PolygonSchema.safeParse(invalid).success).toBe(false);
  });

  test('rejects a missing coordinates field', () => {
    expect(PolygonSchema.safeParse({ type: 'Polygon' }).success).toBe(false);
  });

  test('rejects a vertex latitude of exactly 90 or -90 (exclusive)', () => {
    expect(PolygonSchema.safeParse({ ...validPolygon, coordinates: [[[0, 90]]] }).success).toBe(false);
    expect(PolygonSchema.safeParse({ ...validPolygon, coordinates: [[[0, -90]]] }).success).toBe(false);
  });

  test('accepts a vertex longitude of exactly 180 or -180 (inclusive)', () => {
    expect(PolygonSchema.safeParse({ ...validPolygon, coordinates: [[[180, 0]]] }).success).toBe(true);
    expect(PolygonSchema.safeParse({ ...validPolygon, coordinates: [[[-180, 0]]] }).success).toBe(true);
  });

  test('rejects a vertex longitude beyond 180 or -180', () => {
    expect(PolygonSchema.safeParse({ ...validPolygon, coordinates: [[[180.001, 0]]] }).success).toBe(false);
  });
});
