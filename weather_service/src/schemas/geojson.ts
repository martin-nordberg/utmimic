import { z } from '@hono/zod-openapi';
import { LatitudeSchema, LongitudeSchema } from './common';

// A linear ring needs at least 4 positions and must be closed (first === last) per the GeoJSON
// spec — without this, a structurally-invalid ring (e.g. a 2-point "ring") passes this schema
// and only fails later at ST_GeomFromGeoJSON, uncaught, turning into a 500 instead of a 400.
/** A single linear ring: an array of `[lon, lat]` pairs, at least 4 long and closed. */
const LinearRingSchema = z
  .array(z.tuple([LongitudeSchema, LatitudeSchema]))
  .min(4, 'A linear ring must have at least 4 positions')
  .refine((ring) => {
    const first = ring[0];
    const last = ring[ring.length - 1];
    return first !== undefined && last !== undefined && first[0] === last[0] && first[1] === last[1];
  }, 'A linear ring must be closed (its first and last positions must match)');

// Deliberately narrow: this service only ever accepts/returns a GeoJSON Polygon
// for a weather zone's shape, so a minimal hand-written schema for that one type
// is enough — pulling in a full GeoJSON validation library for one shape isn't
// worth it. No ST_IsValid check on the ring geometry itself (open question).
/** Zod schema for a GeoJSON `Polygon` geometry: an array of linear rings of `[lon, lat]` pairs, each range-checked by {@link LongitudeSchema}/{@link LatitudeSchema}. */
export const PolygonSchema = z
  .object({
    type: z.literal('Polygon'),
    coordinates: z.array(LinearRingSchema).min(1, 'A polygon must have at least one linear ring'),
  })
  .openapi('Polygon');

/** Inferred type of {@link PolygonSchema}, shared by the repositories and PostGIS helper that read/write it. */
export type Polygon = z.infer<typeof PolygonSchema>;
