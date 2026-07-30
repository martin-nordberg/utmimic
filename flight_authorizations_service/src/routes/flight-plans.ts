import { createRoute, z } from '@hono/zod-openapi';
import { DroneRegistrationsServiceUnavailableError } from '../drone-registrations-client';
import { createRouter } from '../openapi-router';
import {
  AirspaceAuthorizationNotFoundError,
  FlightPlanAlreadyExistsError,
  OwnerNotFoundError,
  PilotNotFoundError,
  RegistrationNotFoundError,
  RegistrationOwnerMismatchError,
  getFlightPlanById,
  insertFlightPlan,
  listFlightPlans,
  listIntersectingFlightPlans,
  updateFlightPlan,
} from '../repositories/flight-plans';
import { ErrorSchema } from '../schemas/common';
import {
  CreateFlightPlanSchema,
  FlightPlanIdParamSchema,
  FlightPlanIntersectingQuerySchema,
  FlightPlanSchema,
  ListFlightPlansQuerySchema,
  UpdateFlightPlanSchema,
} from '../schemas/flight-plan';

/** Router mounted at /api/v1/flight-plans. */
export const flightPlansRouter = createRouter();

/** POST / — create a flight plan (waypoints or polygon shape). */
const createFlightPlanRoute = createRoute({
  method: 'post',
  path: '/',
  request: { body: { content: { 'application/json': { schema: CreateFlightPlanSchema } } } },
  responses: {
    201: { content: { 'application/json': { schema: FlightPlanSchema } }, description: 'Flight plan created' },
    404: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'airspaceAuthorizationId not found',
    },
    409: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Flight plan already exists' },
    422: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'ownerId, pilotId, or registrationId not found or mismatched',
    },
    503: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'Drone Registrations Service unavailable',
    },
  },
});

flightPlansRouter.openapi(createFlightPlanRoute, async (c) => {
  const body = c.req.valid('json');
  try {
    const flightPlan = await insertFlightPlan(body);
    return c.json(flightPlan, 201);
  } catch (err) {
    if (err instanceof FlightPlanAlreadyExistsError) return c.json({ message: err.message }, 409);
    if (err instanceof AirspaceAuthorizationNotFoundError) return c.json({ message: err.message }, 404);
    if (
      err instanceof OwnerNotFoundError ||
      err instanceof PilotNotFoundError ||
      err instanceof RegistrationNotFoundError ||
      err instanceof RegistrationOwnerMismatchError
    ) {
      return c.json({ message: err.message }, 422);
    }
    if (err instanceof DroneRegistrationsServiceUnavailableError) return c.json({ message: err.message }, 503);
    throw err;
  }
});

/** GET / — list flight plans, optionally filtered. */
const listFlightPlansRoute = createRoute({
  method: 'get',
  path: '/',
  request: { query: ListFlightPlansQuerySchema },
  responses: {
    200: { content: { 'application/json': { schema: z.array(FlightPlanSchema) } }, description: 'Flight plans' },
  },
});

flightPlansRouter.openapi(listFlightPlansRoute, async (c) => {
  const query = c.req.valid('query');
  const flightPlans = await listFlightPlans(query);
  return c.json(flightPlans, 200);
});

// Registered before /{flightPlanId} so the literal "intersecting" segment isn't swallowed by the
// param route — same reasoning as airspace-authorizations.ts's covering/intersecting ordering.
/** GET /intersecting — flight plan(s) whose shape intersects a lat/lon bounding box. */
const intersectingRoute = createRoute({
  method: 'get',
  path: '/intersecting',
  request: { query: FlightPlanIntersectingQuerySchema },
  responses: {
    200: {
      content: { 'application/json': { schema: z.array(FlightPlanSchema) } },
      description: 'Intersecting flight plans',
    },
  },
});

flightPlansRouter.openapi(intersectingRoute, async (c) => {
  const query = c.req.valid('query');
  const flightPlans = await listIntersectingFlightPlans(
    query.minLat,
    query.minLon,
    query.maxLat,
    query.maxLon,
    query.altitudeFt,
    query.activeAt,
  );
  return c.json(flightPlans, 200);
});

/** GET /{flightPlanId} — fetch a single flight plan (including its waypoints, if any). */
const getFlightPlanRoute = createRoute({
  method: 'get',
  path: '/{flightPlanId}',
  request: { params: FlightPlanIdParamSchema },
  responses: {
    200: { content: { 'application/json': { schema: FlightPlanSchema } }, description: 'Flight plan' },
    404: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Flight plan not found' },
  },
});

flightPlansRouter.openapi(getFlightPlanRoute, async (c) => {
  const { flightPlanId } = c.req.valid('param');
  const flightPlan = await getFlightPlanById(flightPlanId);
  if (!flightPlan) return c.json({ message: `Flight plan ${flightPlanId} not found` }, 404);
  return c.json(flightPlan, 200);
});

/** PATCH /{flightPlanId} — partially update a flight plan (linking fields and time window only). */
const patchFlightPlanRoute = createRoute({
  method: 'patch',
  path: '/{flightPlanId}',
  request: {
    params: FlightPlanIdParamSchema,
    body: { content: { 'application/json': { schema: UpdateFlightPlanSchema } } },
  },
  responses: {
    200: { content: { 'application/json': { schema: FlightPlanSchema } }, description: 'Updated flight plan' },
    404: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'Flight plan or airspaceAuthorizationId not found',
    },
    422: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'pilotId or registrationId not found or mismatched',
    },
    503: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'Drone Registrations Service unavailable',
    },
  },
});

flightPlansRouter.openapi(patchFlightPlanRoute, async (c) => {
  const { flightPlanId } = c.req.valid('param');
  const patch = c.req.valid('json');
  try {
    const flightPlan = await updateFlightPlan(flightPlanId, patch);
    if (!flightPlan) return c.json({ message: `Flight plan ${flightPlanId} not found` }, 404);
    return c.json(flightPlan, 200);
  } catch (err) {
    if (err instanceof AirspaceAuthorizationNotFoundError) return c.json({ message: err.message }, 404);
    if (err instanceof PilotNotFoundError || err instanceof RegistrationNotFoundError || err instanceof RegistrationOwnerMismatchError) {
      return c.json({ message: err.message }, 422);
    }
    if (err instanceof DroneRegistrationsServiceUnavailableError) return c.json({ message: err.message }, 503);
    throw err;
  }
});
