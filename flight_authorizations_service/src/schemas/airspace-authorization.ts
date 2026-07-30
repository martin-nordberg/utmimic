import { z } from '@hono/zod-openapi';
import { LatitudeSchema, LongitudeSchema } from './common';
import { PolygonSchema } from './geojson';

/** Path param schema for routes scoped to an airspace authorization id. */
export const AuthorizationIdParamSchema = z.object({
  authorizationId: z.string().min(1).openapi({
    param: { name: 'authorizationId', in: 'path' },
    example: 'clh6z8h1x0000qzrm',
  }),
});

/** Authorization lifecycle status, matching the table's CHECK constraint. */
export const StatusSchema = z.enum(['proposed', 'approved', 'rescinded']).openapi('AirspaceAuthorizationStatus');

/** Fields shared by airspace authorization request and response schemas, excluding `status`/`rescindedAt` (which have their own lifecycle rules, applied separately). */
const airspaceAuthorizationFields = {
  area: PolygonSchema,
  maxAltitudeFt: z.number().gte(0).lte(2000).openapi({ example: 400 }),
  startTime: z.iso.datetime().openapi({ example: '2026-08-01T14:00:00.000Z' }),
  endTime: z.iso.datetime().openapi({ example: '2026-08-01T18:00:00.000Z' }),
  ownerId: z.string().min(1).openapi({ example: 'clh6owner0000qzrm' }),
  pilotId: z.string().min(1).nullable().openapi({ example: null }),
};

/** Request body schema for creating an airspace authorization; `endTime` must be after `startTime`, mirroring the table's CHECK constraint. */
export const CreateAirspaceAuthorizationSchema = z
  .object({
    authorizationId: z.string().min(1).openapi({ example: 'clh6z8h1x0000qzrm' }),
    ...airspaceAuthorizationFields,
  })
  .refine((auth) => auth.endTime > auth.startTime, {
    message: 'endTime must be after startTime',
    path: ['endTime'],
  })
  .openapi('CreateAirspaceAuthorization');

// area and ownerId are immutable after creation (see the implementation plan's Decisions
// already resolved) — a client that wants to change either creates a new authorization instead.
/** Request body schema for partially updating an airspace authorization, including `status` transitions; `area`/`ownerId` are immutable. */
export const UpdateAirspaceAuthorizationSchema = z
  .object({
    maxAltitudeFt: z.number().gte(0).lte(2000).optional(),
    startTime: z.iso.datetime().optional(),
    endTime: z.iso.datetime().optional(),
    pilotId: z.string().min(1).nullable().optional(),
    status: StatusSchema.optional(),
  })
  .openapi('UpdateAirspaceAuthorization');

/** Response schema for a persisted airspace authorization. */
export const AirspaceAuthorizationSchema = z
  .object({
    authorizationId: z.string().min(1).openapi({ example: 'clh6z8h1x0000qzrm' }),
    ...airspaceAuthorizationFields,
    status: StatusSchema,
    rescindedAt: z.iso.datetime().nullable().openapi({ example: null }),
    createdAt: z.iso.datetime().openapi({ example: '2026-07-25T14:03:11.000Z' }),
    updatedAt: z.iso.datetime().openapi({ example: '2026-07-25T14:03:11.000Z' }),
  })
  .openapi('AirspaceAuthorization');

/** Query params for listing authorizations, all optional and AND'd together. */
export const ListAirspaceAuthorizationsQuerySchema = z.object({
  ownerId: z.string().min(1).optional().openapi({ example: 'clh6owner0000qzrm' }),
  pilotId: z.string().min(1).optional().openapi({ example: 'clh6pilot0000qzrm' }),
  activeAt: z.iso.datetime().optional(),
  status: StatusSchema.optional(),
});

/** Query params for `GET /covering`: `lat`/`lon` required, `at`/`altitudeFt`/`status` optional. */
export const CoveringQuerySchema = z.object({
  lat: LatitudeSchema.openapi({ example: 47.62 }),
  lon: LongitudeSchema.openapi({ example: -122.41 }),
  at: z.iso.datetime().optional(),
  altitudeFt: z.coerce.number().gte(0).lte(2000).optional(),
  status: StatusSchema.optional(),
});

/** Query params for `GET /intersecting`: the bounding box corners required, `altitudeFt`/`at`/`status` optional. */
export const IntersectingQuerySchema = z.object({
  minLat: LatitudeSchema.openapi({ example: 47.55 }),
  minLon: LongitudeSchema.openapi({ example: -122.45 }),
  maxLat: LatitudeSchema.openapi({ example: 47.7 }),
  maxLon: LongitudeSchema.openapi({ example: -122.25 }),
  altitudeFt: z.coerce.number().gte(0).lte(2000).optional(),
  at: z.iso.datetime().optional(),
  status: StatusSchema.optional(),
});
