import { z } from '@hono/zod-openapi';

/** Path param schema for routes scoped to a waiver id. */
export const WaiverIdParamSchema = z.object({
  waiverId: z.string().min(1).openapi({
    param: { name: 'waiverId', in: 'path' },
    example: 'clh6waiv0000qzrm',
  }),
});

/** The FAA Part 107 waiver categories this service models, matching the table's CHECK constraint. */
export const WaiverTypeSchema = z
  .enum(['operations_from_moving_vehicle', 'night_operations', 'beyond_visual_line_of_sight', 'operations_over_people'])
  .openapi('WaiverType');

/** Waiver lifecycle status, matching the table's CHECK constraint — same three values as `airspace_authorizations.status`, defined separately here since the two are otherwise unrelated resources. */
export const StatusSchema = z.enum(['proposed', 'approved', 'rescinded']).openapi('WaiverStatus');

/** Fields shared by waiver request and response schemas, excluding `status`/`rescindedAt` (which have their own lifecycle rules, applied separately). */
const waiverFields = {
  waiverType: WaiverTypeSchema,
  pilotId: z.string().min(1).nullable().openapi({ example: 'clh6pilot0000qzrm' }),
  ownerId: z.string().min(1).nullable().openapi({ example: null }),
  conditions: z.string().min(1).openapi({
    example: 'BVLOS operations limited to a 1200 ft AGL corridor; a visual observer is required at each end of the corridor at all times.',
  }),
  startTime: z.iso.datetime().openapi({ example: '2026-08-01T00:00:00.000Z' }),
  endTime: z.iso.datetime().openapi({ example: '2027-08-01T00:00:00.000Z' }),
};

/** Request body schema for creating a waiver; exactly one of `pilotId`/`ownerId` must be set (mirrors the table's CHECK constraint), and `endTime` must be after `startTime`. */
export const CreateWaiverSchema = z
  .object({
    waiverId: z.string().min(1).openapi({ example: 'clh6waiv0000qzrm' }),
    ...waiverFields,
  })
  .refine((waiver) => (waiver.pilotId != null) !== (waiver.ownerId != null), {
    message: 'Exactly one of pilotId or ownerId must be set',
    path: ['ownerId'],
  })
  .refine((waiver) => waiver.endTime > waiver.startTime, {
    message: 'endTime must be after startTime',
    path: ['endTime'],
  })
  .openapi('CreateWaiver');

// waiverType, pilotId, and ownerId are immutable after creation (see the implementation plan's
// Decisions already resolved) — a client that wants to change who/what a waiver covers creates a
// new waiver instead.
/** Request body schema for partially updating a waiver, including `status` transitions; `waiverType`/`pilotId`/`ownerId` are immutable. */
export const UpdateWaiverSchema = z
  .object({
    conditions: z.string().min(1).optional(),
    startTime: z.iso.datetime().optional(),
    endTime: z.iso.datetime().optional(),
    status: StatusSchema.optional(),
  })
  .openapi('UpdateWaiver');

/** Response schema for a persisted waiver. */
export const WaiverSchema = z
  .object({
    waiverId: z.string().min(1).openapi({ example: 'clh6waiv0000qzrm' }),
    ...waiverFields,
    status: StatusSchema,
    rescindedAt: z.iso.datetime().nullable().openapi({ example: null }),
    createdAt: z.iso.datetime().openapi({ example: '2026-07-25T14:03:11.000Z' }),
    updatedAt: z.iso.datetime().openapi({ example: '2026-07-25T14:03:11.000Z' }),
  })
  .openapi('Waiver');

/** Query params for listing waivers, all optional and AND'd together. */
export const ListWaiversQuerySchema = z.object({
  pilotId: z.string().min(1).optional().openapi({ example: 'clh6pilot0000qzrm' }),
  ownerId: z.string().min(1).optional().openapi({ example: 'clh6owner0000qzrm' }),
  waiverType: WaiverTypeSchema.optional(),
  activeAt: z.iso.datetime().optional(),
  status: StatusSchema.optional(),
});
