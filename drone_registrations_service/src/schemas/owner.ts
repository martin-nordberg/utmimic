import { z } from '@hono/zod-openapi';

/** Whether an owner is an individual person or an organization. */
export const OwnerTypeSchema = z.enum(['individual', 'organization']).openapi('OwnerType');

/** Path param schema for routes scoped to an owner id. */
export const OwnerIdParamSchema = z.object({
  ownerId: z.string().min(1).openapi({
    param: { name: 'ownerId', in: 'path' },
    example: 'clh6z8h1x0000qzrm',
  }),
});

/** Fields shared by owner request and response schemas. */
const ownerFields = {
  ownerType: OwnerTypeSchema.openapi({ example: 'organization' }),
  companyName: z.string().min(1).optional().openapi({ example: 'Acme Aerial Services' }),
  firstName: z.string().min(1).openapi({ example: 'John' }),
  lastName: z.string().min(1).openapi({ example: 'Smith' }),
  phoneNumber: z.string().min(1).openapi({ example: '+1-555-0100' }),
  addressLine1: z.string().min(1).openapi({ example: '123 Main St' }),
  addressLine2: z.string().min(1).optional().openapi({ example: 'Suite 200' }),
  addressCity: z.string().min(1).openapi({ example: 'Springfield' }),
  addressState: z.string().min(1).openapi({ example: 'ST' }),
  addressZip: z.string().min(1).openapi({ example: '00000' }),
  email: z.string().min(1).openapi({ example: 'ops@acme.example' }),
};

/** Request body schema for registering a new owner; `companyName` is required exactly when `ownerType` is `'organization'`, mirroring the table's CHECK constraint. */
export const CreateOwnerSchema = z
  .object({
    ownerId: z.string().min(1).openapi({ example: 'clh6z8h1x0000qzrm' }),
    ...ownerFields,
  })
  .refine((owner) => (owner.ownerType === 'organization') === (owner.companyName !== undefined), {
    message: "companyName is required when ownerType is 'organization', and not allowed otherwise",
    path: ['companyName'],
  })
  .openapi('CreateOwner');

/** Request body schema for partially updating an owner; `ownerType` and `companyName` are immutable after creation. */
export const UpdateOwnerSchema = z
  .object({
    firstName: z.string().min(1).optional(),
    lastName: z.string().min(1).optional(),
    phoneNumber: z.string().min(1).optional(),
    addressLine1: z.string().min(1).optional(),
    addressLine2: z.string().min(1).optional(),
    addressCity: z.string().min(1).optional(),
    addressState: z.string().min(1).optional(),
    addressZip: z.string().min(1).optional(),
    email: z.string().min(1).optional(),
  })
  .openapi('UpdateOwner');

/** Response schema for a persisted owner. */
export const OwnerSchema = z
  .object({
    ownerId: z.string().min(1).openapi({ example: 'clh6z8h1x0000qzrm' }),
    ...ownerFields,
    createdAt: z.iso.datetime().openapi({ example: '2026-07-25T14:03:11.000Z' }),
    updatedAt: z.iso.datetime().openapi({ example: '2026-07-25T14:03:11.000Z' }),
  })
  .openapi('Owner');
