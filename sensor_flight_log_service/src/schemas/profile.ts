import { z } from '@hono/zod-openapi';

export const ProfileBodySchema = z
  .record(z.string(), z.unknown())
  .openapi('ProfileBody', {
    example: {
      pollIntervalMs: { min: 2000, max: 5000 },
      latencyMs: { min: 200, max: 1500 },
      positionErrorStdDev: { metersHorizontal: 15, feetVertical: 20 },
    },
  });

export const SensorProfileSchema = z
  .object({
    sensorId: z.string().min(1).openapi({ example: 'clh6z8h1x0000qzrm' }),
    profile: ProfileBodySchema,
    createdAt: z.iso.datetime().openapi({ example: '2026-07-25T14:03:11.000Z' }),
    updatedAt: z.iso.datetime().openapi({ example: '2026-07-25T14:03:11.000Z' }),
  })
  .openapi('SensorProfile');
