import { createRoute, z } from '@hono/zod-openapi';
import { createRouter } from '../openapi-router';
import { OwnerAlreadyExistsError, getOwnerById, insertOwner, listOwners, updateOwner } from '../repositories/owners';
import { ErrorSchema } from '../schemas/common';
import { CreateOwnerSchema, OwnerIdParamSchema, OwnerSchema, UpdateOwnerSchema } from '../schemas/owner';

/** Router mounted at /api/v1/owners. */
export const ownersRouter = createRouter();

/** POST / — register a new owner. */
const createOwnerRoute = createRoute({
  method: 'post',
  path: '/',
  request: {
    body: { content: { 'application/json': { schema: CreateOwnerSchema } } },
  },
  responses: {
    201: { content: { 'application/json': { schema: OwnerSchema } }, description: 'Owner registered' },
    409: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Owner already exists' },
  },
});

ownersRouter.openapi(createOwnerRoute, async (c) => {
  const body = c.req.valid('json');
  try {
    const owner = await insertOwner(body);
    return c.json(owner, 201);
  } catch (err) {
    if (err instanceof OwnerAlreadyExistsError) {
      return c.json({ message: err.message }, 409);
    }
    throw err;
  }
});

/** GET / — list all owners. */
const listOwnersRoute = createRoute({
  method: 'get',
  path: '/',
  responses: {
    200: { content: { 'application/json': { schema: z.array(OwnerSchema) } }, description: 'List of owners' },
  },
});

ownersRouter.openapi(listOwnersRoute, async (c) => {
  const owners = await listOwners();
  return c.json(owners, 200);
});

/** GET /{ownerId} — fetch a single owner. */
const getOwnerRoute = createRoute({
  method: 'get',
  path: '/{ownerId}',
  request: { params: OwnerIdParamSchema },
  responses: {
    200: { content: { 'application/json': { schema: OwnerSchema } }, description: 'Owner' },
    404: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Owner not found' },
  },
});

ownersRouter.openapi(getOwnerRoute, async (c) => {
  const { ownerId } = c.req.valid('param');
  const owner = await getOwnerById(ownerId);
  if (!owner) return c.json({ message: `Owner ${ownerId} not found` }, 404);
  return c.json(owner, 200);
});

/** PATCH /{ownerId} — partially update an owner. */
const patchOwnerRoute = createRoute({
  method: 'patch',
  path: '/{ownerId}',
  request: {
    params: OwnerIdParamSchema,
    body: { content: { 'application/json': { schema: UpdateOwnerSchema } } },
  },
  responses: {
    200: { content: { 'application/json': { schema: OwnerSchema } }, description: 'Updated owner' },
    404: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Owner not found' },
  },
});

ownersRouter.openapi(patchOwnerRoute, async (c) => {
  const { ownerId } = c.req.valid('param');
  const patch = c.req.valid('json');
  const owner = await updateOwner(ownerId, patch);
  if (!owner) return c.json({ message: `Owner ${ownerId} not found` }, 404);
  return c.json(owner, 200);
});
