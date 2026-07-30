import { z } from '@hono/zod-openapi';

// Deliberately narrow: this service only ever accepts/returns a GeoJSON Polygon
// for a weather zone's shape, so a minimal hand-written schema for that one type
// is enough — pulling in a full GeoJSON validation library for one shape isn't
// worth it. No ST_IsValid check on the ring geometry itself (open question).
/** Zod schema for a GeoJSON `Polygon` geometry: an array of linear rings of `[lon, lat]` pairs. */
export const PolygonSchema = z
  .object({
    type: z.literal('Polygon'),
    coordinates: z.array(z.array(z.tuple([z.number(), z.number()]))),
  })
  .openapi('Polygon');
