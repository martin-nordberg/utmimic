import { z } from 'zod';

/** Required and optional process environment variables for this service. */
const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  PORT: z.coerce.number().int().positive().default(8002),
  LOG_LEVEL: z.string().default('info'),
  DRONE_REGISTRATIONS_SERVICE_URL: z.string().min(1),
});

/** Parsed and validated environment configuration for this service. */
export const config = envSchema.parse(process.env);
