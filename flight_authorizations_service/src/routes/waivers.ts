import { createRoute, z } from '@hono/zod-openapi';
import { DroneRegistrationsServiceUnavailableError } from '../drone-registrations-client';
import { createRouter } from '../openapi-router';
import {
  OwnerNotFoundError,
  PilotNotFoundError,
  RescindedIsTerminalError,
  WaiverAlreadyExistsError,
  getWaiverById,
  insertWaiver,
  listWaivers,
  updateWaiver,
} from '../repositories/waivers';
import { ErrorSchema } from '../schemas/common';
import { CreateWaiverSchema, ListWaiversQuerySchema, UpdateWaiverSchema, WaiverIdParamSchema, WaiverSchema } from '../schemas/waiver';

/** Router mounted at /api/v1/waivers. */
export const waiversRouter = createRouter();

/** POST / — create a waiver. */
const createWaiverRoute = createRoute({
  method: 'post',
  path: '/',
  request: { body: { content: { 'application/json': { schema: CreateWaiverSchema } } } },
  responses: {
    201: { content: { 'application/json': { schema: WaiverSchema } }, description: 'Waiver created' },
    409: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Waiver already exists' },
    422: { content: { 'application/json': { schema: ErrorSchema } }, description: 'pilotId or ownerId not found' },
    503: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'Drone Registrations Service unavailable',
    },
  },
});

waiversRouter.openapi(createWaiverRoute, async (c) => {
  const body = c.req.valid('json');
  try {
    const waiver = await insertWaiver(body);
    return c.json(waiver, 201);
  } catch (err) {
    if (err instanceof WaiverAlreadyExistsError) return c.json({ message: err.message }, 409);
    if (err instanceof OwnerNotFoundError || err instanceof PilotNotFoundError) {
      return c.json({ message: err.message }, 422);
    }
    if (err instanceof DroneRegistrationsServiceUnavailableError) return c.json({ message: err.message }, 503);
    throw err;
  }
});

/** GET / — list waivers, optionally filtered by pilotId/ownerId/waiverType/activeAt/status. */
const listWaiversRoute = createRoute({
  method: 'get',
  path: '/',
  request: { query: ListWaiversQuerySchema },
  responses: {
    200: { content: { 'application/json': { schema: z.array(WaiverSchema) } }, description: 'Waivers' },
  },
});

waiversRouter.openapi(listWaiversRoute, async (c) => {
  const query = c.req.valid('query');
  const waivers = await listWaivers(query);
  return c.json(waivers, 200);
});

/** GET /{waiverId} — fetch a single waiver. */
const getWaiverRoute = createRoute({
  method: 'get',
  path: '/{waiverId}',
  request: { params: WaiverIdParamSchema },
  responses: {
    200: { content: { 'application/json': { schema: WaiverSchema } }, description: 'Waiver' },
    404: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Waiver not found' },
  },
});

waiversRouter.openapi(getWaiverRoute, async (c) => {
  const { waiverId } = c.req.valid('param');
  const waiver = await getWaiverById(waiverId);
  if (!waiver) return c.json({ message: `Waiver ${waiverId} not found` }, 404);
  return c.json(waiver, 200);
});

/** PATCH /{waiverId} — partially update a waiver, including status transitions. */
const patchWaiverRoute = createRoute({
  method: 'patch',
  path: '/{waiverId}',
  request: {
    params: WaiverIdParamSchema,
    body: { content: { 'application/json': { schema: UpdateWaiverSchema } } },
  },
  responses: {
    200: { content: { 'application/json': { schema: WaiverSchema } }, description: 'Updated waiver' },
    404: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Waiver not found' },
    409: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Waiver is rescinded and terminal' },
  },
});

waiversRouter.openapi(patchWaiverRoute, async (c) => {
  const { waiverId } = c.req.valid('param');
  const patch = c.req.valid('json');
  try {
    const waiver = await updateWaiver(waiverId, patch);
    if (!waiver) return c.json({ message: `Waiver ${waiverId} not found` }, 404);
    return c.json(waiver, 200);
  } catch (err) {
    if (err instanceof RescindedIsTerminalError) return c.json({ message: err.message }, 409);
    throw err;
  }
});
