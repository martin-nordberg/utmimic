import { z } from 'zod';

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  PORT: z.coerce.number().int().positive().default(8004),
  LOG_LEVEL: z.string().default('info'),
});

export const config = envSchema.parse(process.env);
