import { z } from '@hono/zod-openapi';
import { OwnerIdParamSchema } from './owner';

/** Path param schema for routes scoped to both an owner and one of its pilots. */
export const PilotParamsSchema = OwnerIdParamSchema.extend({
  pilotId: z.string().min(1).openapi({
    param: { name: 'pilotId', in: 'path' },
    example: 'clh6z8m2x0001qzrm',
  }),
});

/** Path param schema for routes scoped to a pilot id alone, with no owner in the path. */
export const PilotIdParamSchema = z.object({
  pilotId: z.string().min(1).openapi({
    param: { name: 'pilotId', in: 'path' },
    example: 'clh6z8m2x0001qzrm',
  }),
});

/** Fields shared by pilot request and response schemas. */
const pilotFields = {
  name: z.string().min(1).openapi({ example: 'John Pilot' }),
  phoneNumber: z.string().min(1).openapi({ example: '+1-555-0102' }),
  licenseNumber: z.string().min(1).openapi({ example: 'REM-1234567' }),
};

/** Request body schema for adding a pilot under an organization owner. */
export const CreatePilotSchema = z
  .object({
    pilotId: z.string().min(1).openapi({ example: 'clh6z8m2x0001qzrm' }),
    ...pilotFields,
  })
  .openapi('CreatePilot');

/** Request body schema for partially updating a pilot; `organizationOwnerId` is immutable. */
export const UpdatePilotSchema = z
  .object({
    name: z.string().min(1).optional(),
    phoneNumber: z.string().min(1).optional(),
    licenseNumber: z.string().min(1).optional(),
  })
  .openapi('UpdatePilot');

/** Response schema for a persisted pilot. */
export const PilotSchema = z
  .object({
    pilotId: z.string().min(1).openapi({ example: 'clh6z8m2x0001qzrm' }),
    organizationOwnerId: z.string().min(1).openapi({ example: 'clh6z8h1x0000qzrm' }),
    ...pilotFields,
    createdAt: z.iso.datetime().openapi({ example: '2026-07-25T14:03:11.000Z' }),
    updatedAt: z.iso.datetime().openapi({ example: '2026-07-25T14:03:11.000Z' }),
  })
  .openapi('Pilot');
