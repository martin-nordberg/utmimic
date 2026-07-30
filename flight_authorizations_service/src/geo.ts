import { sql } from './db';
import type { Polygon } from './schemas/geojson';

/** SQL fragment converting a GeoJSON Polygon parameter into the stored PostGIS geometry, for use in an INSERT/UPDATE's value list. Ported from weather_service. */
export function geomFromGeoJson(polygon: Polygon) {
  return sql`ST_GeomFromGeoJSON(${JSON.stringify(polygon)})`;
}

/** SQL fragment converting a lat/lon pair into a PostGIS point geometry, for use in an INSERT/UPDATE's value list (writing `flight_plan_waypoints.point` from the API's flat `latitude`/`longitude` fields). */
export function pointFromLatLon(lat: number, lon: number) {
  return sql`ST_SetSRID(ST_MakePoint(${lon}, ${lat}), 4326)`;
}

/** SQL fragment selecting `flight_plan_waypoints.point` back out as flat `latitude`/`longitude` columns, for use in a SELECT list. Only ever queried against that one column, so unlike `geomFromGeoJson`/`intersectsEnvelope` this doesn't need to be column-agnostic. */
export const pointLatLonSelect = sql`ST_Y(point) AS latitude, ST_X(point) AS longitude`;

/**
 * SQL fragment testing whether `airspace_authorizations.area` contains a lat/lon point, for
 * `GET /airspace-authorizations/covering`. Hardcodes the `area` column since this is the only
 * geometry column ever queried this way (a flight plan's shape has no "covering" endpoint,
 * per the spec) — see {@link intersectsEnvelope} for the column-agnostic case.
 */
export function containsPoint(lat: number, lon: number) {
  return sql`ST_Contains(area, ST_SetSRID(ST_MakePoint(${lon}, ${lat}), 4326))`;
}

// Takes the geometry expression as a fragment (produced by a plain `sql` tag, e.g. `sql\`area\``
// or `sql\`ST_Buffer(point, radius_meters)\``) rather than hardcoding a column name, since this
// service has three different geometries an "intersecting" query runs against:
// airspace_authorizations.area, flight_plans.polygon_area, and a per-waypoint buffered cylinder.
// Bun's SQL driver inlines a nested `sql` fragment as raw SQL when interpolated into another one
// (the same composition technique weather_service's spatialFilterCondition relies on), so this
// is not string concatenation / injection — the fragment's own text is never caller-supplied.
/** SQL fragment testing whether a geometry expression intersects a lat/lon bounding box (auto-normalized corners), for the `intersecting` endpoints. */
export function intersectsEnvelope(
  geom: Bun.SQL.Query<unknown>,
  minLat: number,
  minLon: number,
  maxLat: number,
  maxLon: number,
) {
  return sql`ST_Intersects(${geom}, ST_MakeEnvelope(${minLon}, ${minLat}, ${maxLon}, ${maxLat}, 4326))`;
}
