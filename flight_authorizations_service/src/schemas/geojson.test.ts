import { describe, expect, test } from 'bun:test';
import { PointSchema, PolygonSchema } from './geojson';

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

/** A valid closed 4-position ring whose first (and closing) position is `[lon, lat]` and whose other two positions are always in range, for isolating a single vertex value's range validation from the ring-shape checks. */
function ringWithVertex(lon: number, lat: number) {
  return [
    [lon, lat],
    [0, 0],
    [0, 1],
    [lon, lat],
  ];
}

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
    expect(PolygonSchema.safeParse({ ...validPolygon, coordinates: [ringWithVertex(0, 90)] }).success).toBe(false);
    expect(PolygonSchema.safeParse({ ...validPolygon, coordinates: [ringWithVertex(0, -90)] }).success).toBe(false);
  });

  test('accepts a vertex longitude of exactly 180 or -180 (inclusive)', () => {
    expect(PolygonSchema.safeParse({ ...validPolygon, coordinates: [ringWithVertex(180, 0)] }).success).toBe(true);
    expect(PolygonSchema.safeParse({ ...validPolygon, coordinates: [ringWithVertex(-180, 0)] }).success).toBe(true);
  });

  test('rejects a vertex longitude beyond 180 or -180', () => {
    expect(PolygonSchema.safeParse({ ...validPolygon, coordinates: [ringWithVertex(180.001, 0)] }).success).toBe(false);
  });

  test('rejects a ring with fewer than 4 positions', () => {
    const twoPointRing = { ...validPolygon, coordinates: [[[0, 0], [1, 1]]] };
    expect(PolygonSchema.safeParse(twoPointRing).success).toBe(false);
  });

  test('rejects a ring whose first and last positions do not match', () => {
    const unclosed = {
      ...validPolygon,
      coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1]]],
    };
    expect(PolygonSchema.safeParse(unclosed).success).toBe(false);
  });

  test('rejects a polygon with no rings', () => {
    expect(PolygonSchema.safeParse({ ...validPolygon, coordinates: [] }).success).toBe(false);
  });
});

const validPoint = { type: 'Point', coordinates: [-122.41, 47.62] };

describe('PointSchema', () => {
  test('accepts a valid point', () => {
    expect(PointSchema.safeParse(validPoint).success).toBe(true);
  });

  test('rejects a non-Point type', () => {
    expect(PointSchema.safeParse({ ...validPoint, type: 'Polygon' }).success).toBe(false);
  });

  test('rejects a coordinates tuple with only one value', () => {
    expect(PointSchema.safeParse({ ...validPoint, coordinates: [-122.41] }).success).toBe(false);
  });

  test('rejects a latitude of exactly 90 or -90 (exclusive)', () => {
    expect(PointSchema.safeParse({ ...validPoint, coordinates: [0, 90] }).success).toBe(false);
    expect(PointSchema.safeParse({ ...validPoint, coordinates: [0, -90] }).success).toBe(false);
  });

  test('accepts a longitude of exactly 180 or -180 (inclusive)', () => {
    expect(PointSchema.safeParse({ ...validPoint, coordinates: [180, 0] }).success).toBe(true);
    expect(PointSchema.safeParse({ ...validPoint, coordinates: [-180, 0] }).success).toBe(true);
  });

  test('rejects a longitude beyond 180 or -180', () => {
    expect(PointSchema.safeParse({ ...validPoint, coordinates: [180.001, 0] }).success).toBe(false);
  });
});
