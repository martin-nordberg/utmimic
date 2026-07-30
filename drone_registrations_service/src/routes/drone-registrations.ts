import { createRoute, z } from '@hono/zod-openapi';
import { createRouter } from '../openapi-router';
import { getOwnerById } from '../repositories/owners';
import {
  DroneRegistrationAlreadyExistsError,
  DroneRegistrationOwnerNotFoundError,
  OverlappingRegistrationError,
  getActiveRegistrationBySerial,
  getDroneRegistrationById,
  insertDroneRegistration,
  listDroneRegistrations,
  updateDroneRegistration,
} from '../repositories/drone-registrations';
import { ErrorSchema } from '../schemas/common';
import {
  BySerialQuerySchema,
  CreateDroneRegistrationSchema,
  DroneRegistrationSchema,
  ListDroneRegistrationsQuerySchema,
  OwnerDroneRegistrationsQuerySchema,
  RegistrationIdParamSchema,
  SerialNumberParamSchema,
  UpdateDroneRegistrationSchema,
} from '../schemas/drone-registration';
import { OwnerIdParamSchema } from '../schemas/owner';

/** Router mounted at /api/v1/drone-registrations. */
export const droneRegistrationsRouter = createRouter();

/** POST / — create a drone registration. */
const createDroneRegistrationRoute = createRoute({
  method: 'post',
  path: '/',
  request: {
    body: { content: { 'application/json': { schema: CreateDroneRegistrationSchema } } },
  },
  responses: {
    201: { content: { 'application/json': { schema: DroneRegistrationSchema } }, description: 'Registration created' },
    404: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Owner not found' },
    409: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'Registration already exists, or overlaps an existing one for the same serial number',
    },
  },
});

droneRegistrationsRouter.openapi(createDroneRegistrationRoute, async (c) => {
  const body = c.req.valid('json');
  try {
    const registration = await insertDroneRegistration(body);
    return c.json(registration, 201);
  } catch (err) {
    if (err instanceof DroneRegistrationOwnerNotFoundError) {
      return c.json({ message: err.message }, 404);
    }
    if (err instanceof DroneRegistrationAlreadyExistsError || err instanceof OverlappingRegistrationError) {
      return c.json({ message: err.message }, 409);
    }
    throw err;
  }
});

/** GET / — list drone registrations, optionally filtered by serialNumber/ownerId. */
const listDroneRegistrationsRoute = createRoute({
  method: 'get',
  path: '/',
  request: { query: ListDroneRegistrationsQuerySchema },
  responses: {
    200: {
      content: { 'application/json': { schema: z.array(DroneRegistrationSchema) } },
      description: 'List of drone registrations',
    },
  },
});

droneRegistrationsRouter.openapi(listDroneRegistrationsRoute, async (c) => {
  const { serialNumber, ownerId } = c.req.valid('query');
  const registrations = await listDroneRegistrations({ serialNumber, ownerId });
  return c.json(registrations, 200);
});

/** GET /{registrationId} — fetch a single drone registration. */
const getDroneRegistrationRoute = createRoute({
  method: 'get',
  path: '/{registrationId}',
  request: { params: RegistrationIdParamSchema },
  responses: {
    200: { content: { 'application/json': { schema: DroneRegistrationSchema } }, description: 'Drone registration' },
    404: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Registration not found' },
  },
});

droneRegistrationsRouter.openapi(getDroneRegistrationRoute, async (c) => {
  const { registrationId } = c.req.valid('param');
  const registration = await getDroneRegistrationById(registrationId);
  if (!registration) return c.json({ message: `Drone registration ${registrationId} not found` }, 404);
  return c.json(registration, 200);
});

/** PATCH /{registrationId} — partially update a drone registration. */
const patchDroneRegistrationRoute = createRoute({
  method: 'patch',
  path: '/{registrationId}',
  request: {
    params: RegistrationIdParamSchema,
    body: { content: { 'application/json': { schema: UpdateDroneRegistrationSchema } } },
  },
  responses: {
    200: { content: { 'application/json': { schema: DroneRegistrationSchema } }, description: 'Updated registration' },
    404: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Registration not found' },
    409: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'New date range overlaps an existing registration for the same serial number',
    },
  },
});

droneRegistrationsRouter.openapi(patchDroneRegistrationRoute, async (c) => {
  const { registrationId } = c.req.valid('param');
  const patch = c.req.valid('json');
  try {
    const registration = await updateDroneRegistration(registrationId, patch);
    if (!registration) return c.json({ message: `Drone registration ${registrationId} not found` }, 404);
    return c.json(registration, 200);
  } catch (err) {
    if (err instanceof OverlappingRegistrationError) {
      return c.json({ message: err.message }, 409);
    }
    throw err;
  }
});

/** GET /by-serial/{serialNumber} — the registration active for a serial number as of ?asOf= (default today). */
const getBySerialRoute = createRoute({
  method: 'get',
  path: '/by-serial/{serialNumber}',
  request: { params: SerialNumberParamSchema, query: BySerialQuerySchema },
  responses: {
    200: { content: { 'application/json': { schema: DroneRegistrationSchema } }, description: 'Active registration' },
    404: { content: { 'application/json': { schema: ErrorSchema } }, description: 'No active registration' },
  },
});

droneRegistrationsRouter.openapi(getBySerialRoute, async (c) => {
  const { serialNumber } = c.req.valid('param');
  const { asOf } = c.req.valid('query');
  const registration = await getActiveRegistrationBySerial(serialNumber, asOf);
  if (!registration) {
    return c.json({ message: `No active registration for serial number ${serialNumber}` }, 404);
  }
  return c.json(registration, 200);
});

/** Router mounted at /api/v1/owners/{ownerId}/drone-registrations. */
export const ownerDroneRegistrationsRouter = createRouter();

/** GET / — an owner's registrations across all their drones, optionally narrowed to those active as of ?asOf=. */
const listOwnerDroneRegistrationsRoute = createRoute({
  method: 'get',
  path: '/',
  request: { params: OwnerIdParamSchema, query: OwnerDroneRegistrationsQuerySchema },
  responses: {
    200: {
      content: { 'application/json': { schema: z.array(DroneRegistrationSchema) } },
      description: "Owner's drone registrations",
    },
    404: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Owner not found' },
  },
});

ownerDroneRegistrationsRouter.openapi(listOwnerDroneRegistrationsRoute, async (c) => {
  const { ownerId } = c.req.valid('param');
  const { asOf } = c.req.valid('query');
  const owner = await getOwnerById(ownerId);
  if (!owner) return c.json({ message: `Owner ${ownerId} not found` }, 404);
  const registrations = await listDroneRegistrations({ ownerId, asOf });
  return c.json(registrations, 200);
});
