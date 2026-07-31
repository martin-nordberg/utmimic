import { createRoute, z } from '@hono/zod-openapi';
import { createRouter } from '../openapi-router';
import { getOwnerById } from '../repositories/owners';
import {
  PilotAlreadyExistsError,
  PilotOwnerNotFoundError,
  PilotOwnerNotOrganizationError,
  deletePilot,
  getPilotById,
  getPilotByIdOnly,
  insertPilot,
  listPilotsForOwner,
  updatePilot,
} from '../repositories/pilots';
import { ErrorSchema } from '../schemas/common';
import { OwnerIdParamSchema } from '../schemas/owner';
import {
  CreatePilotSchema,
  PilotIdParamSchema,
  PilotParamsSchema,
  PilotSchema,
  UpdatePilotSchema,
} from '../schemas/pilot';

/** Router mounted at /api/v1/owners/{ownerId}/pilots. */
export const pilotsRouter = createRouter();

/** Router mounted at /api/v1/pilots, for looking up a pilot without knowing its owner id. */
export const pilotLookupRouter = createRouter();

/** POST / — add a pilot under an organization owner. */
const createPilotRoute = createRoute({
  method: 'post',
  path: '/',
  request: {
    params: OwnerIdParamSchema,
    body: { content: { 'application/json': { schema: CreatePilotSchema } } },
  },
  responses: {
    201: { content: { 'application/json': { schema: PilotSchema } }, description: 'Pilot added' },
    404: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Owner not found' },
    409: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Pilot already exists' },
    422: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'Owner is not an organization',
    },
  },
});

pilotsRouter.openapi(createPilotRoute, async (c) => {
  const { ownerId } = c.req.valid('param');
  const body = c.req.valid('json');
  try {
    const pilot = await insertPilot(ownerId, body);
    return c.json(pilot, 201);
  } catch (err) {
    if (err instanceof PilotOwnerNotFoundError) {
      return c.json({ message: err.message }, 404);
    }
    if (err instanceof PilotOwnerNotOrganizationError) {
      return c.json({ message: err.message }, 422);
    }
    if (err instanceof PilotAlreadyExistsError) {
      return c.json({ message: err.message }, 409);
    }
    throw err;
  }
});

/** GET / — list an organization owner's pilots. */
const listPilotsRoute = createRoute({
  method: 'get',
  path: '/',
  request: { params: OwnerIdParamSchema },
  responses: {
    200: { content: { 'application/json': { schema: z.array(PilotSchema) } }, description: "Owner's pilots" },
    404: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Owner not found' },
  },
});

pilotsRouter.openapi(listPilotsRoute, async (c) => {
  const { ownerId } = c.req.valid('param');
  const owner = await getOwnerById(ownerId);
  if (!owner) return c.json({ message: `Owner ${ownerId} not found` }, 404);
  const pilots = await listPilotsForOwner(ownerId);
  return c.json(pilots, 200);
});

/** GET /{pilotId} — fetch a single pilot. */
const getPilotRoute = createRoute({
  method: 'get',
  path: '/{pilotId}',
  request: { params: PilotParamsSchema },
  responses: {
    200: { content: { 'application/json': { schema: PilotSchema } }, description: 'Pilot' },
    404: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Pilot not found' },
  },
});

pilotsRouter.openapi(getPilotRoute, async (c) => {
  const { ownerId, pilotId } = c.req.valid('param');
  const pilot = await getPilotById(ownerId, pilotId);
  if (!pilot) return c.json({ message: `Pilot ${pilotId} not found` }, 404);
  return c.json(pilot, 200);
});

/** PATCH /{pilotId} — partially update a pilot. */
const patchPilotRoute = createRoute({
  method: 'patch',
  path: '/{pilotId}',
  request: {
    params: PilotParamsSchema,
    body: { content: { 'application/json': { schema: UpdatePilotSchema } } },
  },
  responses: {
    200: { content: { 'application/json': { schema: PilotSchema } }, description: 'Updated pilot' },
    404: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Pilot not found' },
  },
});

pilotsRouter.openapi(patchPilotRoute, async (c) => {
  const { ownerId, pilotId } = c.req.valid('param');
  const patch = c.req.valid('json');
  const pilot = await updatePilot(ownerId, pilotId, patch);
  if (!pilot) return c.json({ message: `Pilot ${pilotId} not found` }, 404);
  return c.json(pilot, 200);
});

/** DELETE /{pilotId} — remove a pilot. */
const deletePilotRoute = createRoute({
  method: 'delete',
  path: '/{pilotId}',
  request: { params: PilotParamsSchema },
  responses: {
    204: { description: 'Pilot removed' },
    404: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Pilot not found' },
  },
});

pilotsRouter.openapi(deletePilotRoute, async (c) => {
  const { ownerId, pilotId } = c.req.valid('param');
  const deleted = await deletePilot(ownerId, pilotId);
  if (!deleted) return c.json({ message: `Pilot ${pilotId} not found` }, 404);
  return c.body(null, 204);
});

/** GET /{pilotId} — fetch a single pilot by id alone, without needing its owner id. */
const getPilotByIdOnlyRoute = createRoute({
  method: 'get',
  path: '/{pilotId}',
  request: { params: PilotIdParamSchema },
  responses: {
    200: { content: { 'application/json': { schema: PilotSchema } }, description: 'Pilot' },
    404: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Pilot not found' },
  },
});

pilotLookupRouter.openapi(getPilotByIdOnlyRoute, async (c) => {
  const { pilotId } = c.req.valid('param');
  const pilot = await getPilotByIdOnly(pilotId);
  if (!pilot) return c.json({ message: `Pilot ${pilotId} not found` }, 404);
  return c.json(pilot, 200);
});
