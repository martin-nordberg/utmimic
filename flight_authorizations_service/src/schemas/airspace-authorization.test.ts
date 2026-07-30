import { describe, expect, test } from 'bun:test';
import { CreateAirspaceAuthorizationSchema } from './airspace-authorization';

const validAuthorization = {
  authorizationId: 'auth-1',
  area: {
    type: 'Polygon' as const,
    coordinates: [
      [
        [-122.42, 47.61],
        [-122.4, 47.61],
        [-122.4, 47.63],
        [-122.42, 47.63],
        [-122.42, 47.61],
      ],
    ],
  },
  maxAltitudeFt: 400,
  startTime: '2026-08-01T14:00:00.000Z',
  endTime: '2026-08-01T18:00:00.000Z',
  ownerId: 'owner-1',
  pilotId: null,
};

describe('CreateAirspaceAuthorizationSchema', () => {
  test('accepts a valid authorization', () => {
    expect(CreateAirspaceAuthorizationSchema.safeParse(validAuthorization).success).toBe(true);
  });

  test('rejects endTime not after startTime', () => {
    expect(
      CreateAirspaceAuthorizationSchema.safeParse({ ...validAuthorization, endTime: validAuthorization.startTime }).success,
    ).toBe(false);
  });

  test('rejects maxAltitudeFt outside 0-2000', () => {
    expect(CreateAirspaceAuthorizationSchema.safeParse({ ...validAuthorization, maxAltitudeFt: -1 }).success).toBe(false);
    expect(CreateAirspaceAuthorizationSchema.safeParse({ ...validAuthorization, maxAltitudeFt: 2001 }).success).toBe(false);
  });

  test('accepts a null pilotId', () => {
    expect(CreateAirspaceAuthorizationSchema.safeParse({ ...validAuthorization, pilotId: 'pilot-1' }).success).toBe(true);
  });
});
