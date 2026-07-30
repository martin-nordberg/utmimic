import { describe, expect, test } from 'bun:test';
import {
  BySerialQuerySchema,
  CreateDroneRegistrationSchema,
  ListDroneRegistrationsQuerySchema,
  OwnerDroneRegistrationsQuerySchema,
  RegistrationIdParamSchema,
  UpdateDroneRegistrationSchema,
} from './drone-registration';

const validCreate = {
  registrationId: 'clh6z9k9x0000qzrm',
  serialNumber: 'SN-12345',
  make: 'DJI',
  modelNumber: 'Mavic 3',
  ownerId: 'clh6z8h1x0000qzrm',
  startDate: '2026-01-01',
  endDate: '2027-01-01',
};

describe('CreateDroneRegistrationSchema', () => {
  test('accepts a valid registration where endDate is after startDate', () => {
    expect(CreateDroneRegistrationSchema.safeParse(validCreate).success).toBe(true);
  });

  test('accepts a registration where endDate equals startDate', () => {
    expect(
      CreateDroneRegistrationSchema.safeParse({ ...validCreate, startDate: '2026-01-01', endDate: '2026-01-01' })
        .success,
    ).toBe(true);
  });

  test('rejects a registration where endDate precedes startDate', () => {
    expect(
      CreateDroneRegistrationSchema.safeParse({ ...validCreate, startDate: '2026-06-01', endDate: '2026-01-01' })
        .success,
    ).toBe(false);
  });

  test('rejects a malformed date', () => {
    expect(CreateDroneRegistrationSchema.safeParse({ ...validCreate, startDate: '01/01/2026' }).success).toBe(false);
  });

  test('rejects a missing required field', () => {
    const { ownerId, ...rest } = validCreate;
    expect(CreateDroneRegistrationSchema.safeParse(rest).success).toBe(false);
  });
});

describe('UpdateDroneRegistrationSchema', () => {
  test('accepts an empty patch', () => {
    expect(UpdateDroneRegistrationSchema.safeParse({}).success).toBe(true);
  });

  test('accepts a partial patch with a single field', () => {
    expect(UpdateDroneRegistrationSchema.safeParse({ make: 'Autel' }).success).toBe(true);
  });

  test('ownerId and serialNumber are not recognized fields, since they are immutable', () => {
    const result = UpdateDroneRegistrationSchema.safeParse({
      ownerId: 'someone-else',
      serialNumber: 'SN-99999',
    });
    expect(result.success && Object.keys(result.data).length).toBe(0);
  });
});

describe('RegistrationIdParamSchema', () => {
  test('rejects an empty registrationId', () => {
    expect(RegistrationIdParamSchema.safeParse({ registrationId: '' }).success).toBe(false);
  });
});

describe('ListDroneRegistrationsQuerySchema', () => {
  test('accepts no query params', () => {
    expect(ListDroneRegistrationsQuerySchema.safeParse({}).success).toBe(true);
  });

  test('accepts serialNumber and ownerId together', () => {
    const result = ListDroneRegistrationsQuerySchema.safeParse({ serialNumber: 'SN-1', ownerId: 'owner_1' });
    expect(result.success).toBe(true);
    expect(result.success && result.data).toEqual({ serialNumber: 'SN-1', ownerId: 'owner_1' });
  });

  test('rejects an empty serialNumber', () => {
    expect(ListDroneRegistrationsQuerySchema.safeParse({ serialNumber: '' }).success).toBe(false);
  });
});

describe('OwnerDroneRegistrationsQuerySchema', () => {
  test('accepts no asOf', () => {
    expect(OwnerDroneRegistrationsQuerySchema.safeParse({}).success).toBe(true);
  });

  test('accepts a valid asOf date', () => {
    expect(OwnerDroneRegistrationsQuerySchema.safeParse({ asOf: '2026-07-25' }).success).toBe(true);
  });

  test('rejects a non-date asOf', () => {
    expect(OwnerDroneRegistrationsQuerySchema.safeParse({ asOf: 'yesterday' }).success).toBe(false);
  });
});

describe('BySerialQuerySchema', () => {
  test('accepts no asOf', () => {
    expect(BySerialQuerySchema.safeParse({}).success).toBe(true);
  });

  test('accepts a valid asOf date', () => {
    expect(BySerialQuerySchema.safeParse({ asOf: '2026-07-25' }).success).toBe(true);
  });

  test('rejects a datetime (not a plain date) for asOf', () => {
    expect(BySerialQuerySchema.safeParse({ asOf: '2026-07-25T14:00:00.000Z' }).success).toBe(false);
  });
});
