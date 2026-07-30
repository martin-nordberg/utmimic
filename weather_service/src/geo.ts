import { sql } from './db';

/** The GeoJSON Polygon shape this service reads and writes (see schemas/geojson.ts). */
export interface PolygonGeoJson {
  type: 'Polygon';
  coordinates: number[][][];
}

/** SQL fragment converting a GeoJSON Polygon parameter into the stored PostGIS geometry, for use in an INSERT's VALUES list. */
export function geomFromGeoJson(polygon: PolygonGeoJson) {
  return sql`ST_GeomFromGeoJSON(${JSON.stringify(polygon)})`;
}

/** SQL fragment selecting a stored `geom` column back out as a GeoJSON Polygon aliased `polygon`, for use in a SELECT list. */
export const polygonSelect = sql`ST_AsGeoJSON(geom)::json AS polygon`;
