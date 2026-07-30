import { describe, expect, test } from 'bun:test';
import { toSpatialFilter } from './geo';

describe('toSpatialFilter', () => {
  test('resolves a complete point', () => {
    expect(toSpatialFilter({ lat: 47.62, lon: -122.35 })).toEqual({ kind: 'point', lat: 47.62, lon: -122.35 });
  });

  test('resolves a complete extent', () => {
    expect(toSpatialFilter({ lat1: 47.55, lon1: -122.45, lat2: 47.7, lon2: -122.25 })).toEqual({
      kind: 'extent',
      lat1: 47.55,
      lon1: -122.45,
      lat2: 47.7,
      lon2: -122.25,
    });
  });

  test('prefers the point when (in violation of the schema invariant) both are somehow present', () => {
    expect(toSpatialFilter({ lat: 47.62, lon: -122.35, lat1: 47.55, lon1: -122.45, lat2: 47.7, lon2: -122.25 })).toEqual({
      kind: 'point',
      lat: 47.62,
      lon: -122.35,
    });
  });

  test('throws when neither a complete point nor a complete extent is present', () => {
    expect(() => toSpatialFilter({})).toThrow();
  });
});
