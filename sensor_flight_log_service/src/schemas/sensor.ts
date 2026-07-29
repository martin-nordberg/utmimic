import { z } from '@hono/zod-openapi';

export const SensorStatusSchema = z.enum(['online', 'offline']).openapi('SensorStatus');

export const SensorIdParamSchema = z.object({
  sensorId: z.string().min(1).openapi({
    param: { name: 'sensorId', in: 'path' },
    example: 'clh6z8h1x0000qzrm',
  }),
});

export const SensorSchema = z
  .object({
    sensorId: z.string().min(1).openapi({ example: 'clh6z8h1x0000qzrm' }),
    name: z.string().min(1).openapi({ example: 'West Ridge' }),
    notes: z
      .string()
      .nullable()
      .openapi({ example: 'Mast-mounted, north side of the ridge' }),
    latitude: z.number().openapi({ example: 47.63 }),
    longitude: z.number().openapi({ example: -122.36 }),
    sensingRadiusMeters: z.number().positive().openapi({ example: 5000 }),
    status: SensorStatusSchema,
    createdAt: z.iso.datetime().openapi({ example: '2026-07-25T14:03:11.000Z' }),
    updatedAt: z.iso.datetime().openapi({ example: '2026-07-25T14:03:11.000Z' }),
  })
  .openapi('Sensor');

export const CreateSensorSchema = z
  .object({
    sensorId: z.string().min(1).openapi({ example: 'clh6z8h1x0000qzrm' }),
    name: z.string().min(1).openapi({ example: 'West Ridge' }),
    notes: z
      .string()
      .optional()
      .openapi({ example: 'Mast-mounted, north side of the ridge' }),
    latitude: z.number().openapi({ example: 47.63 }),
    longitude: z.number().openapi({ example: -122.36 }),
    sensingRadiusMeters: z.number().positive().openapi({ example: 5000 }),
    status: SensorStatusSchema.optional().default('offline'),
  })
  .openapi('CreateSensor');

export const UpdateSensorSchema = z
  .object({
    name: z.string().min(1).optional(),
    notes: z.string().optional(),
    latitude: z.number().optional(),
    longitude: z.number().optional(),
    sensingRadiusMeters: z.number().positive().optional(),
    status: SensorStatusSchema.optional(),
  })
  .openapi('UpdateSensor');
