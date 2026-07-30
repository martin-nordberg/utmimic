import { sql } from './db';
import type { Polygon } from './schemas/geojson';

/** SQL fragment converting a GeoJSON Polygon parameter into the stored PostGIS geometry, for use in an INSERT's VALUES list. */
export function geomFromGeoJson(polygon: Polygon) {
  return sql`ST_GeomFromGeoJSON(${JSON.stringify(polygon)})`;
}

/** SQL fragment selecting a stored `geom` column back out as a GeoJSON Polygon aliased `polygon`, for use in a SELECT list. */
export const polygonSelect = sql`ST_AsGeoJSON(geom)::json AS polygon`;

/** Shape of a validated `.../current` query, carrying either a point or an extent (see `*CurrentQuerySchema`). */
export interface SpatialFilterQuery {
  lat?: number;
  lon?: number;
  lat1?: number;
  lon1?: number;
  lat2?: number;
  lon2?: number;
}

/** A resolved point-or-extent spatial filter, as produced by {@link toSpatialFilter}. */
export type SpatialFilter =
  | { kind: 'point'; lat: number; lon: number }
  | { kind: 'extent'; lat1: number; lon1: number; lat2: number; lon2: number };

/**
 * Resolves a validated `.../current` query into a `SpatialFilter`. Assumes the query schema's
 * `superRefine` already guaranteed exactly one complete group (point or extent) is present.
 */
export function toSpatialFilter(query: SpatialFilterQuery): SpatialFilter {
  if (query.lat !== undefined && query.lon !== undefined) {
    return { kind: 'point', lat: query.lat, lon: query.lon };
  }
  if (query.lat1 !== undefined && query.lon1 !== undefined && query.lat2 !== undefined && query.lon2 !== undefined) {
    return { kind: 'extent', lat1: query.lat1, lon1: query.lon1, lat2: query.lat2, lon2: query.lon2 };
  }
  throw new Error('toSpatialFilter: query has neither a complete point nor a complete extent');
}

/**
 * SQL fragment testing `geom` against a point (`ST_Contains`) or an extent (`ST_Intersects` against
 * a bounding box built from the two corners, auto-normalized via `LEAST`/`GREATEST` so the corners
 * can be given in either order). Does not handle an extent crossing the antimeridian.
 */
export function spatialFilterCondition(filter: SpatialFilter) {
  if (filter.kind === 'point') {
    return sql`ST_Contains(geom, ST_SetSRID(ST_MakePoint(${filter.lon}, ${filter.lat}), 4326))`;
  }
  return sql`ST_Intersects(geom, ST_MakeEnvelope(
    LEAST(${filter.lon1}, ${filter.lon2}), LEAST(${filter.lat1}, ${filter.lat2}),
    GREATEST(${filter.lon1}, ${filter.lon2}), GREATEST(${filter.lat1}, ${filter.lat2}),
    4326
  ))`;
}
