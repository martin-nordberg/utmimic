import { z } from '@hono/zod-openapi';
import { LatitudeSchema, LongitudeSchema } from './common';
import { PolygonSchema } from './geojson';

/** Path param schema for routes scoped to a flight plan id. */
export const FlightPlanIdParamSchema = z.object({
  flightPlanId: z.string().min(1).openapi({
    param: { name: 'flightPlanId', in: 'path' },
    example: 'clh6plan0000qzrm',
  }),
});

// radiusMeters has no bound beyond being a number — the spec leaves it unconstrained (see the
// module doc's Open questions), so this schema doesn't invent a limit that isn't decided yet.
/** A single flight-plan waypoint: a lat/lon point, an altitude band `(altitudeMinFt, altitudeMaxFt]`, and a cylinder radius. */
export const WaypointSchema = z
  .object({
    latitude: LatitudeSchema.openapi({ example: 47.615 }),
    longitude: LongitudeSchema.openapi({ example: -122.415 }),
    altitudeMinFt: z.number().gte(0).lte(2000).openapi({ example: 250 }),
    altitudeMaxFt: z.number().gte(0).lte(2000).openapi({ example: 350 }),
    radiusMeters: z.number().openapi({ example: 50 }),
  })
  .refine((wp) => wp.altitudeMaxFt > wp.altitudeMinFt, {
    message: 'altitudeMaxFt must be greater than altitudeMinFt',
    path: ['altitudeMaxFt'],
  })
  .openapi('Waypoint');

/** Fields shared by both `planType` branches of a flight plan request. */
const flightPlanSharedFields = {
  flightPlanId: z.string().min(1).openapi({ example: 'clh6plan0000qzrm' }),
  ownerId: z.string().min(1).openapi({ example: 'clh6owner0000qzrm' }),
  registrationId: z.string().min(1).nullable().openapi({ example: null }),
  pilotId: z.string().min(1).nullable().openapi({ example: null }),
  airspaceAuthorizationId: z.string().min(1).nullable().openapi({ example: null }),
  startTime: z.iso.datetime().openapi({ example: '2026-08-01T14:30:00.000Z' }),
  endTime: z.iso.datetime().openapi({ example: '2026-08-01T15:30:00.000Z' }),
};

// .strict() on both branches: a plain z.object silently strips unrecognized keys rather than
// rejecting them, so without this a request with planType: 'waypoints' alongside a polygonArea
// field would parse "successfully" (just dropping polygonArea) instead of getting a 400 for the
// contradictory shape.
/** Request body schema for the `'waypoints'` shape of a flight plan. */
const CreateWaypointsFlightPlanSchema = z
  .object({
    planType: z.literal('waypoints'),
    ...flightPlanSharedFields,
    waypoints: z.array(WaypointSchema).min(1),
  })
  .strict();

/** Request body schema for the `'polygon'` shape of a flight plan. */
const CreatePolygonFlightPlanSchema = z
  .object({
    planType: z.literal('polygon'),
    ...flightPlanSharedFields,
    polygonArea: PolygonSchema,
    polygonMaxAltitudeFt: z.number().gte(0).lte(2000).openapi({ example: 250 }),
  })
  .strict();

/** Request body schema for creating a flight plan — a discriminated union on `planType`, since the two shapes are mutually exclusive (mirrors the table's CHECK constraints). Both branches require `endTime` after `startTime`. */
export const CreateFlightPlanSchema = z
  .discriminatedUnion('planType', [CreateWaypointsFlightPlanSchema, CreatePolygonFlightPlanSchema])
  .refine((plan) => plan.endTime > plan.startTime, {
    message: 'endTime must be after startTime',
    path: ['endTime'],
  })
  .openapi('CreateFlightPlan');

// planType, ownerId, and the shape fields (waypoints, or polygonArea/polygonMaxAltitudeFt) are
// immutable after creation (see the implementation plan's Decisions already resolved) — a client
// that wants to change any of those creates a new flight plan instead.
/** Request body schema for partially updating a flight plan; only linking fields and the time window are patchable. */
export const UpdateFlightPlanSchema = z
  .object({
    registrationId: z.string().min(1).nullable().optional(),
    pilotId: z.string().min(1).nullable().optional(),
    airspaceAuthorizationId: z.string().min(1).nullable().optional(),
    startTime: z.iso.datetime().optional(),
    endTime: z.iso.datetime().optional(),
  })
  .openapi('UpdateFlightPlan');

/** Fields shared by both `planType` branches of a flight plan response. */
const flightPlanResponseSharedFields = {
  ...flightPlanSharedFields,
  createdAt: z.iso.datetime().openapi({ example: '2026-07-25T14:03:11.000Z' }),
  updatedAt: z.iso.datetime().openapi({ example: '2026-07-25T14:03:11.000Z' }),
};

/** Response schema for the `'waypoints'` shape of a persisted flight plan, including its ordered waypoints. */
const WaypointsFlightPlanSchema = z.object({
  planType: z.literal('waypoints'),
  ...flightPlanResponseSharedFields,
  waypoints: z.array(WaypointSchema),
});

/** Response schema for the `'polygon'` shape of a persisted flight plan. */
const PolygonFlightPlanSchema = z.object({
  planType: z.literal('polygon'),
  ...flightPlanResponseSharedFields,
  polygonArea: PolygonSchema,
  polygonMaxAltitudeFt: z.number(),
});

/** Response schema for a persisted flight plan — a discriminated union on `planType`, mirroring `CreateFlightPlanSchema`. */
export const FlightPlanSchema = z
  .discriminatedUnion('planType', [WaypointsFlightPlanSchema, PolygonFlightPlanSchema])
  .openapi('FlightPlan');

/** Query params for listing flight plans, all optional and AND'd together. */
export const ListFlightPlansQuerySchema = z.object({
  ownerId: z.string().min(1).optional().openapi({ example: 'clh6owner0000qzrm' }),
  registrationId: z.string().min(1).optional().openapi({ example: 'clh6reg00000qzrm' }),
  pilotId: z.string().min(1).optional().openapi({ example: 'clh6pilot0000qzrm' }),
  airspaceAuthorizationId: z.string().min(1).optional().openapi({ example: 'clh6z8h1x0000qzrm' }),
  activeAt: z.iso.datetime().optional(),
});

/** Query params for `GET /intersecting`: the bounding box corners required, `altitudeFt`/`activeAt` optional. No `status` — flight plans don't have one. */
export const FlightPlanIntersectingQuerySchema = z.object({
  minLat: LatitudeSchema.openapi({ example: 47.55 }),
  minLon: LongitudeSchema.openapi({ example: -122.45 }),
  maxLat: LatitudeSchema.openapi({ example: 47.7 }),
  maxLon: LongitudeSchema.openapi({ example: -122.25 }),
  altitudeFt: z.coerce.number().gte(0).lte(2000).optional(),
  activeAt: z.iso.datetime().optional(),
});
