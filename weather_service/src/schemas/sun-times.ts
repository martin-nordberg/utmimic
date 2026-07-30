import { z } from '@hono/zod-openapi';
import { LatitudeSchema, LongitudeSchema } from './common';

/** Query params for a sun-times lookup: a calendar date and a point. */
export const SunTimesQuerySchema = z.object({
  date: z.iso.date().openapi({ example: '2026-07-30' }),
  lat: LatitudeSchema.openapi({ example: 47.6062 }),
  lon: LongitudeSchema.openapi({ example: -122.3321 }),
});

/** Response schema for a sun-times lookup; fields are `null` for events that don't occur (polar day/night). */
export const SunTimesSchema = z
  .object({
    morningCivilTwilightBeginsAt: z.iso.datetime().nullable().openapi({ example: '2026-07-30T12:08:12.821Z' }),
    sunriseAt: z.iso.datetime().nullable().openapi({ example: '2026-07-30T12:44:35.217Z' }),
    sunsetAt: z.iso.datetime().nullable().openapi({ example: '2026-07-31T03:46:11.609Z' }),
    eveningCivilTwilightEndsAt: z.iso.datetime().nullable().openapi({ example: '2026-07-31T04:22:23.394Z' }),
  })
  .openapi('SunTimes');
