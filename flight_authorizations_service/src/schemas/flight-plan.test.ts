import { describe, expect, test } from 'bun:test';
import { CreateFlightPlanSchema } from './flight-plan';

const validWaypoints = {
  flightPlanId: 'plan-1',
  planType: 'waypoints' as const,
  ownerId: 'owner-1',
  registrationId: null,
  pilotId: null,
  airspaceAuthorizationId: null,
  startTime: '2026-08-01T14:30:00.000Z',
  endTime: '2026-08-01T15:30:00.000Z',
  waypoints: [{ latitude: 47.615, longitude: -122.415, altitudeMinFt: 250, altitudeMaxFt: 350, radiusMeters: 50 }],
};

const validPolygon = {
  flightPlanId: 'plan-2',
  planType: 'polygon' as const,
  ownerId: 'owner-1',
  registrationId: null,
  pilotId: null,
  airspaceAuthorizationId: null,
  startTime: '2026-08-01T16:00:00.000Z',
  endTime: '2026-08-01T17:00:00.000Z',
  polygonArea: {
    type: 'Polygon' as const,
    coordinates: [
      [
        [-122.41, 47.61],
        [-122.4, 47.61],
        [-122.4, 47.62],
        [-122.41, 47.62],
        [-122.41, 47.61],
      ],
    ],
  },
  polygonMaxAltitudeFt: 250,
};

describe('CreateFlightPlanSchema', () => {
  test('accepts a valid waypoints-shaped plan', () => {
    expect(CreateFlightPlanSchema.safeParse(validWaypoints).success).toBe(true);
  });

  test('accepts a valid polygon-shaped plan', () => {
    expect(CreateFlightPlanSchema.safeParse(validPolygon).success).toBe(true);
  });

  test('rejects a waypoints plan carrying polygonArea/polygonMaxAltitudeFt', () => {
    const invalid = { ...validWaypoints, polygonArea: validPolygon.polygonArea, polygonMaxAltitudeFt: 250 };
    expect(CreateFlightPlanSchema.safeParse(invalid).success).toBe(false);
  });

  test('rejects a polygon plan carrying waypoints', () => {
    const invalid = { ...validPolygon, waypoints: validWaypoints.waypoints };
    expect(CreateFlightPlanSchema.safeParse(invalid).success).toBe(false);
  });

  test('rejects a waypoints plan with an empty waypoints array', () => {
    expect(CreateFlightPlanSchema.safeParse({ ...validWaypoints, waypoints: [] }).success).toBe(false);
  });

  test('rejects a waypoint with altitudeMaxFt not greater than altitudeMinFt', () => {
    const invalid = {
      ...validWaypoints,
      waypoints: [{ ...validWaypoints.waypoints[0], altitudeMinFt: 300, altitudeMaxFt: 300 }],
    };
    expect(CreateFlightPlanSchema.safeParse(invalid).success).toBe(false);
  });

  test('rejects endTime not after startTime, for both shapes', () => {
    expect(CreateFlightPlanSchema.safeParse({ ...validWaypoints, endTime: validWaypoints.startTime }).success).toBe(false);
    expect(CreateFlightPlanSchema.safeParse({ ...validPolygon, endTime: validPolygon.startTime }).success).toBe(false);
  });

  test('rejects an unrecognized planType', () => {
    expect(CreateFlightPlanSchema.safeParse({ ...validWaypoints, planType: 'circle' }).success).toBe(false);
  });
});
