import { z } from '@hono/zod-openapi';

export const ErrorSchema = z
  .object({
    message: z.string().openapi({ example: 'Sensor not found' }),
  })
  .openapi('Error');
