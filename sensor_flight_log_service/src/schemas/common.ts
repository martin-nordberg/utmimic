import { z } from '@hono/zod-openapi';

/** Standard `{ message }` shape for API error responses. */
export const ErrorSchema = z
  .object({
    message: z.string().openapi({ example: 'Sensor not found' }),
  })
  .openapi('Error');

// Exclusive of the poles themselves: a latitude of exactly ±90 makes longitude degenerate
// (every meridian meets at the pole), which would otherwise need special-casing throughout the
// spatial queries — same rationale as weather_service/flight_authorizations_service's identical
// schema.
/** Latitude in degrees, exclusive of the poles: `-90 < lat < 90`. Shared by every latitude field this service accepts (a sensor's fixed position, a position report's coordinates). */
export const LatitudeSchema = z.number().gt(-90).lt(90);

/** Longitude in degrees, inclusive of the antimeridian: `-180 <= lon <= 180`. Shared by every longitude field this service accepts. */
export const LongitudeSchema = z.number().gte(-180).lte(180);
