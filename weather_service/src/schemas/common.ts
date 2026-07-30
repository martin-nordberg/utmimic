import { z } from '@hono/zod-openapi';

/** Standard `{ message }` shape for API error responses. */
export const ErrorSchema = z
  .object({
    message: z.string().openapi({ example: 'No observed reports for zone clh6z8h1x0000qzrm...' }),
  })
  .openapi('Error');

// Exclusive of the poles themselves: a latitude of exactly ±90 makes longitude degenerate
// (every meridian meets at the pole), which would otherwise need special-casing throughout
// the spatial queries below.
/** Latitude in degrees, exclusive of the poles: `-90 < lat < 90`. Shared by every latitude field this service accepts (query params and polygon vertices alike). */
export const LatitudeSchema = z.coerce.number().gt(-90).lt(90);

/** Longitude in degrees, inclusive of the antimeridian: `-180 <= lon <= 180`. Shared by every longitude field this service accepts (query params and polygon vertices alike). */
export const LongitudeSchema = z.coerce.number().gte(-180).lte(180);

/** Optional point (`lat`/`lon`) and extent (`lat1`/`lon1`/`lat2`/`lon2`) query fields for a `.../current` lookup. */
const spatialFilterFields = {
  lat: LatitudeSchema.optional().openapi({ example: 47.62 }),
  lon: LongitudeSchema.optional().openapi({ example: -122.35 }),
  lat1: LatitudeSchema.optional().openapi({ example: 47.55 }),
  lon1: LongitudeSchema.optional().openapi({ example: -122.45 }),
  lat2: LatitudeSchema.optional().openapi({ example: 47.7 }),
  lon2: LongitudeSchema.optional().openapi({ example: -122.25 }),
};

/**
 * Validates that a `.../current` query carries either a complete point (`lat`/`lon`) or a
 * complete extent (`lat1`/`lon1`/`lat2`/`lon2`) — never both, never neither, and never a
 * partial group — and that a given extent has nonzero width and height. Domain-agnostic (no
 * visibility/wind-specific fields), so it's shared here rather than duplicated per zone kind,
 * unlike the zone-specific report schemas.
 */
function validateSpatialFilter(
  query: { lat?: number; lon?: number; lat1?: number; lon1?: number; lat2?: number; lon2?: number },
  ctx: z.RefinementCtx,
) {
  const hasPoint = query.lat !== undefined || query.lon !== undefined;
  const hasExtent =
    query.lat1 !== undefined || query.lon1 !== undefined || query.lat2 !== undefined || query.lon2 !== undefined;
  const pointComplete = query.lat !== undefined && query.lon !== undefined;
  const extentComplete =
    query.lat1 !== undefined && query.lon1 !== undefined && query.lat2 !== undefined && query.lon2 !== undefined;

  if (hasPoint && hasExtent) {
    ctx.addIssue({ code: 'custom', message: 'Provide either lat/lon or lat1/lon1/lat2/lon2, not both' });
  } else if (hasPoint && !pointComplete) {
    ctx.addIssue({ code: 'custom', path: ['lon'], message: 'lat and lon must both be provided' });
  } else if (hasExtent && !extentComplete) {
    ctx.addIssue({ code: 'custom', path: ['lat1'], message: 'lat1, lon1, lat2, and lon2 must all be provided' });
  } else if (!hasPoint && !hasExtent) {
    ctx.addIssue({ code: 'custom', message: 'Provide either a point (lat/lon) or an extent (lat1/lon1/lat2/lon2)' });
  } else if (extentComplete) {
    if (query.lat1 === query.lat2) {
      ctx.addIssue({ code: 'custom', path: ['lat2'], message: 'The extent must have nonzero height (lat1 and lat2 must differ)' });
    }
    if (query.lon1 === query.lon2) {
      ctx.addIssue({ code: 'custom', path: ['lon2'], message: 'The extent must have nonzero width (lon1 and lon2 must differ)' });
    }
  }
}

/** Optional point/extent fields, as read by {@link validateSpatialFilter} regardless of what else a `.../current` schema's `extraFields` contribute. */
type SpatialFilterFields = { lat?: number; lon?: number; lat1?: number; lon1?: number; lat2?: number; lon2?: number };

/** Builds a `.../current` query schema: the point/extent spatial fields plus caller-supplied extra fields (e.g. `at`). */
export function withSpatialFilter<Shape extends z.ZodRawShape>(extraFields: Shape) {
  return z
    .object({ ...spatialFilterFields, ...extraFields })
    .superRefine((query, ctx) => validateSpatialFilter(query as SpatialFilterFields, ctx));
}
