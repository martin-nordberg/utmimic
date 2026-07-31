import { createRoute, z } from '@hono/zod-openapi';
import { DroneRegistrationsServiceUnavailableError } from '../drone-registrations-client';
import { createRouter } from '../openapi-router';
import {
  ApprovedIsImmutableError,
  AuthorizationAlreadyExistsError,
  OwnerNotFoundError,
  PilotNotFoundError,
  RescindedIsTerminalError,
  getAirspaceAuthorizationById,
  insertAirspaceAuthorization,
  listAirspaceAuthorizations,
  listCoveringAuthorizations,
  listIntersectingAuthorizations,
  updateAirspaceAuthorization,
} from '../repositories/airspace-authorizations';
import {
  AirspaceAuthorizationSchema,
  AuthorizationIdParamSchema,
  CoveringQuerySchema,
  CreateAirspaceAuthorizationSchema,
  IntersectingQuerySchema,
  ListAirspaceAuthorizationsQuerySchema,
  UpdateAirspaceAuthorizationSchema,
} from '../schemas/airspace-authorization';
import { ErrorSchema } from '../schemas/common';

/** Router mounted at /api/v1/airspace-authorizations. */
export const airspaceAuthorizationsRouter = createRouter();

/** POST / — create an airspace authorization. */
const createAuthorizationRoute = createRoute({
  method: 'post',
  path: '/',
  request: { body: { content: { 'application/json': { schema: CreateAirspaceAuthorizationSchema } } } },
  responses: {
    201: {
      content: { 'application/json': { schema: AirspaceAuthorizationSchema } },
      description: 'Authorization created',
    },
    409: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Authorization already exists' },
    422: { content: { 'application/json': { schema: ErrorSchema } }, description: 'ownerId or pilotId not found' },
    503: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'Drone Registrations Service unavailable',
    },
  },
});

airspaceAuthorizationsRouter.openapi(createAuthorizationRoute, async (c) => {
  const body = c.req.valid('json');
  try {
    const authorization = await insertAirspaceAuthorization(body);
    return c.json(authorization, 201);
  } catch (err) {
    if (err instanceof AuthorizationAlreadyExistsError) return c.json({ message: err.message }, 409);
    if (err instanceof OwnerNotFoundError || err instanceof PilotNotFoundError) {
      return c.json({ message: err.message }, 422);
    }
    if (err instanceof DroneRegistrationsServiceUnavailableError) return c.json({ message: err.message }, 503);
    throw err;
  }
});

/** GET / — list authorizations, optionally filtered by ownerId/pilotId/activeAt/status. */
const listAuthorizationsRoute = createRoute({
  method: 'get',
  path: '/',
  request: { query: ListAirspaceAuthorizationsQuerySchema },
  responses: {
    200: {
      content: { 'application/json': { schema: z.array(AirspaceAuthorizationSchema) } },
      description: 'Authorizations',
    },
  },
});

airspaceAuthorizationsRouter.openapi(listAuthorizationsRoute, async (c) => {
  const query = c.req.valid('query');
  const authorizations = await listAirspaceAuthorizations(query);
  return c.json(authorizations, 200);
});

// Registered before /{authorizationId} so a literal "covering"/"intersecting" segment isn't
// swallowed by the param route — see the implementation plan's note on route ordering.
/** GET /covering — authorization(s) covering a point and time. */
const coveringRoute = createRoute({
  method: 'get',
  path: '/covering',
  request: { query: CoveringQuerySchema },
  responses: {
    200: {
      content: { 'application/json': { schema: z.array(AirspaceAuthorizationSchema) } },
      description: 'Covering authorizations',
    },
  },
});

airspaceAuthorizationsRouter.openapi(coveringRoute, async (c) => {
  const query = c.req.valid('query');
  const at = query.at ?? new Date().toISOString();
  const authorizations = await listCoveringAuthorizations(query.lat, query.lon, at, query.altitudeFt, query.status);
  return c.json(authorizations, 200);
});

/** GET /intersecting — authorization(s) whose area intersects a lat/lon bounding box. */
const intersectingRoute = createRoute({
  method: 'get',
  path: '/intersecting',
  request: { query: IntersectingQuerySchema },
  responses: {
    200: {
      content: { 'application/json': { schema: z.array(AirspaceAuthorizationSchema) } },
      description: 'Intersecting authorizations',
    },
  },
});

airspaceAuthorizationsRouter.openapi(intersectingRoute, async (c) => {
  const query = c.req.valid('query');
  const authorizations = await listIntersectingAuthorizations(
    query.minLat,
    query.minLon,
    query.maxLat,
    query.maxLon,
    query.altitudeFt,
    query.at,
    query.status,
  );
  return c.json(authorizations, 200);
});

/** GET /{authorizationId} — fetch a single authorization. */
const getAuthorizationRoute = createRoute({
  method: 'get',
  path: '/{authorizationId}',
  request: { params: AuthorizationIdParamSchema },
  responses: {
    200: { content: { 'application/json': { schema: AirspaceAuthorizationSchema } }, description: 'Authorization' },
    404: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Authorization not found' },
  },
});

airspaceAuthorizationsRouter.openapi(getAuthorizationRoute, async (c) => {
  const { authorizationId } = c.req.valid('param');
  const authorization = await getAirspaceAuthorizationById(authorizationId);
  if (!authorization) return c.json({ message: `Airspace authorization ${authorizationId} not found` }, 404);
  return c.json(authorization, 200);
});

/** PATCH /{authorizationId} — partially update an authorization, including status transitions. */
const patchAuthorizationRoute = createRoute({
  method: 'patch',
  path: '/{authorizationId}',
  request: {
    params: AuthorizationIdParamSchema,
    body: { content: { 'application/json': { schema: UpdateAirspaceAuthorizationSchema } } },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: AirspaceAuthorizationSchema } },
      description: 'Updated authorization',
    },
    404: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Authorization not found' },
    409: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: "Authorization is rescinded (fully immutable) or approved and this patch isn't a pure rescind",
    },
    422: { content: { 'application/json': { schema: ErrorSchema } }, description: 'pilotId not found' },
    503: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'Drone Registrations Service unavailable',
    },
  },
});

airspaceAuthorizationsRouter.openapi(patchAuthorizationRoute, async (c) => {
  const { authorizationId } = c.req.valid('param');
  const patch = c.req.valid('json');
  try {
    const authorization = await updateAirspaceAuthorization(authorizationId, patch);
    if (!authorization) return c.json({ message: `Airspace authorization ${authorizationId} not found` }, 404);
    return c.json(authorization, 200);
  } catch (err) {
    if (err instanceof RescindedIsTerminalError || err instanceof ApprovedIsImmutableError) {
      return c.json({ message: err.message }, 409);
    }
    if (err instanceof PilotNotFoundError) return c.json({ message: err.message }, 422);
    if (err instanceof DroneRegistrationsServiceUnavailableError) return c.json({ message: err.message }, 503);
    throw err;
  }
});
