import { z } from '@hono/zod-openapi';

/** Path param schema for routes scoped to a drone registration id. */
export const RegistrationIdParamSchema = z.object({
  registrationId: z.string().min(1).openapi({
    param: { name: 'registrationId', in: 'path' },
    example: 'clh6z9k9x0000qzrm',
  }),
});

/** Path param schema for routes scoped to a drone's serial number. */
export const SerialNumberParamSchema = z.object({
  serialNumber: z.string().min(1).openapi({
    param: { name: 'serialNumber', in: 'path' },
    example: 'SN-12345',
  }),
});

/** Fields shared by drone registration request and response schemas. */
const droneRegistrationFields = {
  serialNumber: z.string().min(1).openapi({ example: 'SN-12345' }),
  make: z.string().min(1).openapi({ example: 'DJI' }),
  modelNumber: z.string().min(1).openapi({ example: 'Mavic 3' }),
  ownerId: z.string().min(1).openapi({ example: 'clh6z8h1x0000qzrm' }),
  startDate: z.iso.date().openapi({ example: '2026-01-01' }),
  endDate: z.iso.date().openapi({ example: '2027-01-01' }),
};

/** Request body schema for creating a drone registration; `endDate` must not precede `startDate`, mirroring the table's CHECK constraint. */
export const CreateDroneRegistrationSchema = z
  .object({
    registrationId: z.string().min(1).openapi({ example: 'clh6z9k9x0000qzrm' }),
    ...droneRegistrationFields,
  })
  .refine((registration) => registration.endDate >= registration.startDate, {
    message: 'endDate must not precede startDate',
    path: ['endDate'],
  })
  .openapi('CreateDroneRegistration');

/** Request body schema for partially updating a drone registration; `ownerId` and `serialNumber` are immutable. */
export const UpdateDroneRegistrationSchema = z
  .object({
    make: z.string().min(1).optional(),
    modelNumber: z.string().min(1).optional(),
    startDate: z.iso.date().optional(),
    endDate: z.iso.date().optional(),
  })
  .openapi('UpdateDroneRegistration');

/** Response schema for a persisted drone registration. */
export const DroneRegistrationSchema = z
  .object({
    registrationId: z.string().min(1).openapi({ example: 'clh6z9k9x0000qzrm' }),
    ...droneRegistrationFields,
    createdAt: z.iso.datetime().openapi({ example: '2026-07-25T14:03:11.000Z' }),
    updatedAt: z.iso.datetime().openapi({ example: '2026-07-25T14:03:11.000Z' }),
  })
  .openapi('DroneRegistration');

/** Query params for listing drone registrations, optionally filtered by `serialNumber`/`ownerId` (AND'd together when both are given). */
export const ListDroneRegistrationsQuerySchema = z.object({
  serialNumber: z.string().min(1).optional().openapi({ example: 'SN-12345' }),
  ownerId: z.string().min(1).optional().openapi({ example: 'clh6z8h1x0000qzrm' }),
});

/** Query params for an owner's nested registration listing: `asOf` narrows to registrations active on that date. */
export const OwnerDroneRegistrationsQuerySchema = z.object({
  asOf: z.iso.date().optional().openapi({ example: '2026-07-25' }),
});

/** Query params for `by-serial`; `asOf` defaults to today at the repository layer, since "today" isn't a static Zod default. */
export const BySerialQuerySchema = z.object({
  asOf: z.iso.date().optional().openapi({ example: '2026-07-25' }),
});
