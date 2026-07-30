import { describe, expect, test } from 'bun:test';
import { CreateOwnerSchema, OwnerIdParamSchema, UpdateOwnerSchema } from './owner';

const validIndividual = {
  ownerId: 'clh6z8h1x0000qzrm',
  ownerType: 'individual',
  firstName: 'Jane',
  lastName: 'Doe',
  phoneNumber: '+1-555-0101',
  addressLine1: '1 Elm St',
  addressCity: 'Springfield',
  addressState: 'ST',
  addressZip: '00001',
  email: 'jane@example.com',
};

const validOrganization = {
  ...validIndividual,
  ownerType: 'organization',
  companyName: 'Acme Aerial Services',
  firstName: 'John',
  lastName: 'Smith',
};

describe('CreateOwnerSchema', () => {
  test('accepts a valid individual owner with no companyName', () => {
    expect(CreateOwnerSchema.safeParse(validIndividual).success).toBe(true);
  });

  test('accepts a valid organization owner with companyName', () => {
    expect(CreateOwnerSchema.safeParse(validOrganization).success).toBe(true);
  });

  test('rejects an organization owner missing companyName', () => {
    const { companyName, ...rest } = validOrganization;
    expect(CreateOwnerSchema.safeParse(rest).success).toBe(false);
  });

  test('rejects an individual owner that sets companyName', () => {
    expect(CreateOwnerSchema.safeParse({ ...validIndividual, companyName: 'Should not be here' }).success).toBe(
      false,
    );
  });

  test('rejects an invalid ownerType value', () => {
    expect(CreateOwnerSchema.safeParse({ ...validIndividual, ownerType: 'business' }).success).toBe(false);
  });

  test('rejects a missing required field', () => {
    const { email, ...rest } = validIndividual;
    expect(CreateOwnerSchema.safeParse(rest).success).toBe(false);
  });
});

describe('UpdateOwnerSchema', () => {
  test('accepts an empty patch', () => {
    expect(UpdateOwnerSchema.safeParse({}).success).toBe(true);
  });

  test('accepts a partial patch with a single field', () => {
    expect(UpdateOwnerSchema.safeParse({ phoneNumber: '+1-555-9999' }).success).toBe(true);
  });

  test('rejects ownerType, since it is immutable after creation', () => {
    const result = UpdateOwnerSchema.safeParse({ ownerType: 'organization' });
    expect(result.success && Object.keys(result.data).length).toBe(0);
  });

  test('rejects an empty string for a patchable field', () => {
    expect(UpdateOwnerSchema.safeParse({ firstName: '' }).success).toBe(false);
  });
});

describe('OwnerIdParamSchema', () => {
  test('accepts a non-empty ownerId', () => {
    expect(OwnerIdParamSchema.safeParse({ ownerId: 'clh6z8h1x0000qzrm' }).success).toBe(true);
  });

  test('rejects an empty ownerId', () => {
    expect(OwnerIdParamSchema.safeParse({ ownerId: '' }).success).toBe(false);
  });
});
