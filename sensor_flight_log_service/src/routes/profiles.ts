import { createRoute } from '@hono/zod-openapi';
import { createRouter } from '../openapi-router';
import { ProfileSensorNotFoundError, deleteProfile, getProfile, upsertProfile } from '../repositories/profiles';
import { ErrorSchema } from '../schemas/common';
import { ProfileBodySchema, SensorProfileSchema } from '../schemas/profile';
import { SensorIdParamSchema } from '../schemas/sensor';

export const profilesRouter = createRouter();

const putProfileRoute = createRoute({
  method: 'put',
  path: '/',
  request: {
    params: SensorIdParamSchema,
    body: { content: { 'application/json': { schema: ProfileBodySchema } } },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: SensorProfileSchema } },
      description: 'Profile created or replaced',
    },
    404: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Sensor not found' },
  },
});

profilesRouter.openapi(putProfileRoute, async (c) => {
  const { sensorId } = c.req.valid('param');
  const profile = c.req.valid('json');
  try {
    const record = await upsertProfile(sensorId, profile);
    return c.json(record, 200);
  } catch (err) {
    if (err instanceof ProfileSensorNotFoundError) {
      return c.json({ message: err.message }, 404);
    }
    throw err;
  }
});

const getProfileRoute = createRoute({
  method: 'get',
  path: '/',
  request: { params: SensorIdParamSchema },
  responses: {
    200: { content: { 'application/json': { schema: SensorProfileSchema } }, description: 'Sensor profile' },
    404: { content: { 'application/json': { schema: ErrorSchema } }, description: 'No profile set' },
  },
});

profilesRouter.openapi(getProfileRoute, async (c) => {
  const { sensorId } = c.req.valid('param');
  const profile = await getProfile(sensorId);
  if (!profile) return c.json({ message: `No profile set for sensor ${sensorId}` }, 404);
  return c.json(profile, 200);
});

const deleteProfileRoute = createRoute({
  method: 'delete',
  path: '/',
  request: { params: SensorIdParamSchema },
  responses: {
    204: { description: 'Profile removed' },
  },
});

profilesRouter.openapi(deleteProfileRoute, async (c) => {
  const { sensorId } = c.req.valid('param');
  await deleteProfile(sensorId);
  return c.body(null, 204);
});
