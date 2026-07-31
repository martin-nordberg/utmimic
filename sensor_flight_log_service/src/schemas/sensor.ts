import { z } from '@hono/zod-openapi';
import { LatitudeSchema, LongitudeSchema } from './common';

/** Lifecycle status of a sensor. */
export const SensorStatusSchema = z.enum(['online', 'offline']).openapi('SensorStatus');

/** Path param schema for routes scoped to a sensor id. */
export const SensorIdParamSchema = z.object({
  sensorId: z.string().min(1).openapi({
    param: { name: 'sensorId', in: 'path' },
    example: 'clh6z8h1x0000qzrm',
  }),
});

/** Response schema for a persisted sensor. */
export const SensorSchema = z
  .object({
    sensorId: z.string().min(1).openapi({ example: 'clh6z8h1x0000qzrm' }),
    name: z.string().min(1).openapi({ example: 'West Ridge' }),
    notes: z
      .string()
      .nullable()
      .openapi({ example: 'Mast-mounted, north side of the ridge' }),
    latitude: LatitudeSchema.openapi({ example: 47.63 }),
    longitude: LongitudeSchema.openapi({ example: -122.36 }),
    sensingRadiusMeters: z.number().positive().openapi({ example: 5000 }),
    status: SensorStatusSchema,
    createdAt: z.iso.datetime().openapi({ example: '2026-07-25T14:03:11.000Z' }),
    updatedAt: z.iso.datetime().openapi({ example: '2026-07-25T14:03:11.000Z' }),
  })
  .openapi('Sensor');

/** Request body schema for registering a new sensor. */
export const CreateSensorSchema = z
  .object({
    sensorId: z.string().min(1).openapi({ example: 'clh6z8h1x0000qzrm' }),
    name: z.string().min(1).openapi({ example: 'West Ridge' }),
    notes: z
      .string()
      .optional()
      .openapi({ example: 'Mast-mounted, north side of the ridge' }),
    latitude: LatitudeSchema.openapi({ example: 47.63 }),
    longitude: LongitudeSchema.openapi({ example: -122.36 }),
    sensingRadiusMeters: z.number().positive().openapi({ example: 5000 }),
    status: SensorStatusSchema.optional().default('offline'),
  })
  .openapi('CreateSensor');

/** Request body schema for partially updating a sensor. */
export const UpdateSensorSchema = z
  .object({
    name: z.string().min(1).optional(),
    notes: z.string().optional(),
    latitude: LatitudeSchema.optional(),
    longitude: LongitudeSchema.optional(),
    sensingRadiusMeters: z.number().positive().optional(),
    status: SensorStatusSchema.optional(),
  })
  .openapi('UpdateSensor');
