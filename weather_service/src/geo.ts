import { sql } from './db';
import type { Polygon } from './schemas/geojson';

/** SQL fragment converting a GeoJSON Polygon parameter into the stored PostGIS geometry, for use in an INSERT's VALUES list. */
export function geomFromGeoJson(polygon: Polygon) {
  return sql`ST_GeomFromGeoJSON(${JSON.stringify(polygon)})`;
}

/** SQL fragment selecting a stored `geom` column back out as a GeoJSON Polygon aliased `polygon`, for use in a SELECT list. */
export const polygonSelect = sql`ST_AsGeoJSON(geom)::json AS polygon`;
