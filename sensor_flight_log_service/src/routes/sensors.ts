import { createRoute, z } from '@hono/zod-openapi';
import { createRouter } from '../openapi-router';
import {
  SensorAlreadyExistsError,
  getSensorById,
  insertSensor,
  listSensors,
  updateSensor,
} from '../repositories/sensors';
import { ErrorSchema } from '../schemas/common';
import { CreateSensorSchema, SensorIdParamSchema, SensorSchema, UpdateSensorSchema } from '../schemas/sensor';

export const sensorsRouter = createRouter();

const createSensorRoute = createRoute({
  method: 'post',
  path: '/',
  request: {
    body: { content: { 'application/json': { schema: CreateSensorSchema } } },
  },
  responses: {
    201: { content: { 'application/json': { schema: SensorSchema } }, description: 'Sensor registered' },
    409: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Sensor already exists' },
  },
});

sensorsRouter.openapi(createSensorRoute, async (c) => {
  const body = c.req.valid('json');
  try {
    const sensor = await insertSensor(body);
    return c.json(sensor, 201);
  } catch (err) {
    if (err instanceof SensorAlreadyExistsError) {
      return c.json({ message: err.message }, 409);
    }
    throw err;
  }
});

const listSensorsRoute = createRoute({
  method: 'get',
  path: '/',
  responses: {
    200: { content: { 'application/json': { schema: z.array(SensorSchema) } }, description: 'List of sensors' },
  },
});

sensorsRouter.openapi(listSensorsRoute, async (c) => {
  const sensors = await listSensors();
  return c.json(sensors, 200);
});

const getSensorRoute = createRoute({
  method: 'get',
  path: '/{sensorId}',
  request: { params: SensorIdParamSchema },
  responses: {
    200: { content: { 'application/json': { schema: SensorSchema } }, description: 'Sensor' },
    404: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Sensor not found' },
  },
});

sensorsRouter.openapi(getSensorRoute, async (c) => {
  const { sensorId } = c.req.valid('param');
  const sensor = await getSensorById(sensorId);
  if (!sensor) return c.json({ message: `Sensor ${sensorId} not found` }, 404);
  return c.json(sensor, 200);
});

const patchSensorRoute = createRoute({
  method: 'patch',
  path: '/{sensorId}',
  request: {
    params: SensorIdParamSchema,
    body: { content: { 'application/json': { schema: UpdateSensorSchema } } },
  },
  responses: {
    200: { content: { 'application/json': { schema: SensorSchema } }, description: 'Updated sensor' },
    404: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Sensor not found' },
  },
});

sensorsRouter.openapi(patchSensorRoute, async (c) => {
  const { sensorId } = c.req.valid('param');
  const patch = c.req.valid('json');
  const sensor = await updateSensor(sensorId, patch);
  if (!sensor) return c.json({ message: `Sensor ${sensorId} not found` }, 404);
  return c.json(sensor, 200);
});
