import { describe, expect, test } from 'bun:test';
import { CreatePilotSchema, PilotParamsSchema, UpdatePilotSchema } from './pilot';

const validCreate = {
  pilotId: 'clh6z8m2x0001qzrm',
  name: 'John Pilot',
  phoneNumber: '+1-555-0102',
  licenseNumber: 'REM-1234567',
};

describe('CreatePilotSchema', () => {
  test('accepts a fully valid pilot', () => {
    expect(CreatePilotSchema.safeParse(validCreate).success).toBe(true);
  });

  test('rejects a missing required field', () => {
    const { licenseNumber, ...rest } = validCreate;
    expect(CreatePilotSchema.safeParse(rest).success).toBe(false);
  });

  test('rejects an empty pilotId', () => {
    expect(CreatePilotSchema.safeParse({ ...validCreate, pilotId: '' }).success).toBe(false);
  });
});

describe('UpdatePilotSchema', () => {
  test('accepts an empty patch', () => {
    expect(UpdatePilotSchema.safeParse({}).success).toBe(true);
  });

  test('accepts a partial patch with a single field', () => {
    expect(UpdatePilotSchema.safeParse({ licenseNumber: 'REM-7654321' }).success).toBe(true);
  });

  test('organizationOwnerId is not a recognized field, since it is immutable after creation', () => {
    const result = UpdatePilotSchema.safeParse({ organizationOwnerId: 'clh6z8h1x0000qzrm' });
    expect(result.success && Object.keys(result.data).length).toBe(0);
  });
});

describe('PilotParamsSchema', () => {
  test('accepts a valid ownerId/pilotId pair', () => {
    expect(PilotParamsSchema.safeParse({ ownerId: 'owner_1', pilotId: 'pilot_1' }).success).toBe(true);
  });

  test('rejects a missing pilotId', () => {
    expect(PilotParamsSchema.safeParse({ ownerId: 'owner_1' }).success).toBe(false);
  });
});
