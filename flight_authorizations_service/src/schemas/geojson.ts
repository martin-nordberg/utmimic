import { z } from '@hono/zod-openapi';
import { LatitudeSchema, LongitudeSchema } from './common';

// Deliberately narrow: this service only ever accepts/returns a GeoJSON Polygon for an
// authorization's area or a flight plan's polygon shape, so a minimal hand-written schema
// for that one type is enough — pulling in a full GeoJSON validation library for one shape
// isn't worth it. Ported from weather_service, which made the same call. No ST_IsValid check
// on the ring geometry itself (open question there, unaddressed here too).
/** Zod schema for a GeoJSON `Polygon` geometry: an array of linear rings of `[lon, lat]` pairs, each range-checked by {@link LongitudeSchema}/{@link LatitudeSchema}. */
export const PolygonSchema = z
  .object({
    type: z.literal('Polygon'),
    coordinates: z.array(z.array(z.tuple([LongitudeSchema, LatitudeSchema]))),
  })
  .openapi('Polygon');

/** Inferred type of {@link PolygonSchema}, shared by the repositories and PostGIS helper that read/write it. */
export type Polygon = z.infer<typeof PolygonSchema>;

// Not exposed directly in any request/response body — the API's waypoint shape is flat
// latitude/longitude fields (see the spec's POST /flight-plans example), not nested GeoJSON.
// This exists for geo.ts's point read/write helpers and for unit testing the coordinate tuple
// shape in isolation from the flatter waypoint schema.
/** Zod schema for a GeoJSON `Point` geometry: a single `[lon, lat]` pair, range-checked by {@link LongitudeSchema}/{@link LatitudeSchema}. */
export const PointSchema = z
  .object({
    type: z.literal('Point'),
    coordinates: z.tuple([LongitudeSchema, LatitudeSchema]),
  })
  .openapi('Point');

/** Inferred type of {@link PointSchema}. */
export type Point = z.infer<typeof PointSchema>;
