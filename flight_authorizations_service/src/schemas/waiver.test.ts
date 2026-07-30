import { describe, expect, test } from 'bun:test';
import { CreateWaiverSchema } from './waiver';

const basePilotWaiver = {
  waiverId: 'waiver-1',
  waiverType: 'beyond_visual_line_of_sight' as const,
  pilotId: 'pilot-1',
  ownerId: null,
  conditions: 'Some conditions.',
  startTime: '2026-08-01T00:00:00.000Z',
  endTime: '2027-08-01T00:00:00.000Z',
};

const baseOwnerWaiver = { ...basePilotWaiver, pilotId: null, ownerId: 'owner-1' };

describe('CreateWaiverSchema', () => {
  test('accepts a valid pilot-linked waiver', () => {
    expect(CreateWaiverSchema.safeParse(basePilotWaiver).success).toBe(true);
  });

  test('accepts a valid owner-linked waiver', () => {
    expect(CreateWaiverSchema.safeParse(baseOwnerWaiver).success).toBe(true);
  });

  test('rejects both pilotId and ownerId set', () => {
    const invalid = { ...basePilotWaiver, ownerId: 'owner-1' };
    expect(CreateWaiverSchema.safeParse(invalid).success).toBe(false);
  });

  test('rejects neither pilotId nor ownerId set', () => {
    const invalid = { ...basePilotWaiver, pilotId: null };
    expect(CreateWaiverSchema.safeParse(invalid).success).toBe(false);
  });

  test('rejects an unrecognized waiverType', () => {
    expect(CreateWaiverSchema.safeParse({ ...basePilotWaiver, waiverType: 'flying_at_night' }).success).toBe(false);
  });

  test('rejects endTime not after startTime', () => {
    expect(CreateWaiverSchema.safeParse({ ...basePilotWaiver, endTime: basePilotWaiver.startTime }).success).toBe(false);
  });

  test('rejects an empty conditions string', () => {
    expect(CreateWaiverSchema.safeParse({ ...basePilotWaiver, conditions: '' }).success).toBe(false);
  });
});
