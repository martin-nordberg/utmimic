import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { app } from './app';
import { sql } from './db';
import { startDroneRegistrationsService, type DroneRegistrationsServiceHandle } from './test-support/drone-registrations-service';
import { resetSchema } from './test-support/reset-db';

async function jsonBody<T = Record<string, unknown>>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

const jsonHeaders = { 'Content-Type': 'application/json' };

const DRONE_REGISTRATIONS_BASE_URL = 'http://localhost:8001/api/v1';

/** POSTs to Drone Registrations Service directly, tolerating 409 (already seeded by a prior run) as success. */
async function seed(path: string, body: Record<string, unknown>): Promise<void> {
  const res = await fetch(`${DRONE_REGISTRATIONS_BASE_URL}${path}`, {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify(body),
  });
  if (res.status !== 201 && res.status !== 409) {
    throw new Error(`Seeding ${path} failed: ${res.status} ${await res.text()}`);
  }
}

let droneRegistrationsService: DroneRegistrationsServiceHandle;

beforeAll(async () => {
  await resetSchema();
  droneRegistrationsService = await startDroneRegistrationsService();

  await seed('/owners', {
    ownerId: 'fasit-owner-1',
    ownerType: 'individual',
    firstName: 'Jane',
    lastName: 'Doe',
    phoneNumber: '+1-555-0101',
    addressLine1: '1 Elm St',
    addressCity: 'Springfield',
    addressState: 'ST',
    addressZip: '00001',
    email: 'jane@example.com',
  });
  await seed('/owners', {
    ownerId: 'fasit-owner-org',
    ownerType: 'organization',
    companyName: 'Acme Aerial Services',
    firstName: 'John',
    lastName: 'Smith',
    phoneNumber: '+1-555-0100',
    addressLine1: '123 Main St',
    addressCity: 'Springfield',
    addressState: 'ST',
    addressZip: '00000',
    email: 'ops@acme.example',
  });
  await seed('/owners', {
    ownerId: 'fasit-owner-other',
    ownerType: 'individual',
    firstName: 'Bob',
    lastName: 'Other',
    phoneNumber: '+1-555-0200',
    addressLine1: '2 Main St',
    addressCity: 'Springfield',
    addressState: 'ST',
    addressZip: '00000',
    email: 'bob@example.com',
  });
  await seed('/owners/fasit-owner-org/pilots', {
    pilotId: 'fasit-pilot-1',
    name: 'John Pilot',
    phoneNumber: '+1-555-0102',
    licenseNumber: 'REM-1234567',
  });
  await seed('/drone-registrations', {
    registrationId: 'fasit-reg-1',
    serialNumber: 'FASIT-SN-1',
    make: 'DJI',
    modelNumber: 'Mavic 3',
    ownerId: 'fasit-owner-1',
    startDate: '2026-01-01',
    endDate: '2027-01-01',
  });
  await seed('/drone-registrations', {
    registrationId: 'fasit-reg-other',
    serialNumber: 'FASIT-SN-2',
    make: 'DJI',
    modelNumber: 'Mini 4',
    ownerId: 'fasit-owner-other',
    startDate: '2026-01-01',
    endDate: '2027-01-01',
  });
});

afterAll(async () => {
  droneRegistrationsService.stop();
  await sql.close();
});

describe('flight_authorizations_service (end-to-end)', () => {
  test('rejects a body-carrying request with the wrong Content-Type', async () => {
    const res = await app.request('/api/v1/airspace-authorizations', {
      method: 'POST',
      body: JSON.stringify({ authorizationId: 'wrong-content-type' }),
    });
    expect(res.status).toBe(415);
  });

  test('rejects syntactically-broken JSON with a { message } JSON body, not a plain-text one', async () => {
    const res = await app.request('/api/v1/airspace-authorizations', {
      method: 'POST',
      headers: jsonHeaders,
      body: '{not valid json',
    });
    expect(res.status).toBe(400);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(await jsonBody<{ message: string }>(res)).toEqual({ message: 'Malformed JSON in request body' });
  });

  test('validation failures return { message } like every other error, not the default ZodError shape', async () => {
    const res = await app.request('/api/v1/airspace-authorizations', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ ownerId: 'fasit-owner-1' }),
    });
    expect(res.status).toBe(400);
    const body = await jsonBody<{ message: string }>(res);
    expect(typeof body.message).toBe('string');
    expect(body).not.toHaveProperty('success');
    expect(body).not.toHaveProperty('error');
  });

  describe('airspace authorizations', () => {
    const authorization = {
      authorizationId: 'fasit-auth-1',
      area: {
        type: 'Polygon',
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
      ownerId: 'fasit-owner-1',
      pilotId: null,
    };

    test('422s for an unknown ownerId', async () => {
      const res = await app.request('/api/v1/airspace-authorizations', {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({ ...authorization, ownerId: 'no-such-owner' }),
      });
      expect(res.status).toBe(422);
    });

    test('422s when pilotId exists but belongs to a different owner', async () => {
      const res = await app.request('/api/v1/airspace-authorizations', {
        method: 'POST',
        headers: jsonHeaders,
        // fasit-pilot-1 belongs to fasit-owner-org, not fasit-owner-1
        body: JSON.stringify({ ...authorization, ownerId: 'fasit-owner-1', pilotId: 'fasit-pilot-1' }),
      });
      expect(res.status).toBe(422);
    });

    test('creates an authorization against known-good ownerId/pilotId', async () => {
      const res = await app.request('/api/v1/airspace-authorizations', {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({ ...authorization, authorizationId: 'fasit-auth-owner-pilot', ownerId: 'fasit-owner-org', pilotId: 'fasit-pilot-1' }),
      });
      expect(res.status).toBe(201);
    });

    test('creates an authorization, rejects a duplicate id, gets it, and lists it', async () => {
      const created = await app.request('/api/v1/airspace-authorizations', {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify(authorization),
      });
      expect(created.status).toBe(201);
      expect((await jsonBody<{ status: string }>(created)).status).toBe('proposed');

      const duplicate = await app.request('/api/v1/airspace-authorizations', {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify(authorization),
      });
      expect(duplicate.status).toBe(409);

      const fetched = await app.request(`/api/v1/airspace-authorizations/${authorization.authorizationId}`);
      expect(fetched.status).toBe(200);

      const listed = await app.request(`/api/v1/airspace-authorizations?ownerId=${authorization.ownerId}`);
      expect(listed.status).toBe(200);
      const ids = (await jsonBody<{ authorizationId: string }[]>(listed)).map((a) => a.authorizationId);
      expect(ids).toContain(authorization.authorizationId);

      const notFound = await app.request('/api/v1/airspace-authorizations/no-such-auth');
      expect(notFound.status).toBe(404);
    });

    test('covering finds a point inside the polygon during the active window, misses outside/before/after', async () => {
      const inside = await app.request(
        `/api/v1/airspace-authorizations/covering?lat=47.62&lon=-122.41&at=2026-08-01T15:00:00.000Z`,
      );
      expect(inside.status).toBe(200);
      const insideIds = (await jsonBody<{ authorizationId: string }[]>(inside)).map((a) => a.authorizationId);
      expect(insideIds).toContain(authorization.authorizationId);

      const outsidePoint = await app.request(
        `/api/v1/airspace-authorizations/covering?lat=10&lon=10&at=2026-08-01T15:00:00.000Z`,
      );
      expect((await jsonBody<unknown[]>(outsidePoint)).length).toBe(0);

      const outsideWindow = await app.request(
        `/api/v1/airspace-authorizations/covering?lat=47.62&lon=-122.41&at=2026-08-02T15:00:00.000Z`,
      );
      const outsideWindowIds = (await jsonBody<{ authorizationId: string }[]>(outsideWindow)).map((a) => a.authorizationId);
      expect(outsideWindowIds).not.toContain(authorization.authorizationId);

      const wrongAltitude = await app.request(
        `/api/v1/airspace-authorizations/covering?lat=47.62&lon=-122.41&at=2026-08-01T15:00:00.000Z&altitudeFt=500`,
      );
      const wrongAltitudeIds = (await jsonBody<{ authorizationId: string }[]>(wrongAltitude)).map((a) => a.authorizationId);
      expect(wrongAltitudeIds).not.toContain(authorization.authorizationId);
    });

    test('intersecting finds an overlapping bounding box, misses a disjoint one', async () => {
      const hit = await app.request(
        '/api/v1/airspace-authorizations/intersecting?minLat=47.55&minLon=-122.45&maxLat=47.7&maxLon=-122.25',
      );
      const hitIds = (await jsonBody<{ authorizationId: string }[]>(hit)).map((a) => a.authorizationId);
      expect(hitIds).toContain(authorization.authorizationId);

      const miss = await app.request('/api/v1/airspace-authorizations/intersecting?minLat=10&minLon=10&maxLat=11&maxLon=11');
      expect((await jsonBody<unknown[]>(miss)).length).toBe(0);
    });

    test('status lifecycle: proposed -> approved -> rescinded, then a further status change 409s', async () => {
      const approved = await app.request(`/api/v1/airspace-authorizations/${authorization.authorizationId}`, {
        method: 'PATCH',
        headers: jsonHeaders,
        body: JSON.stringify({ status: 'approved' }),
      });
      expect(approved.status).toBe(200);
      expect((await jsonBody<{ status: string }>(approved)).status).toBe('approved');

      const rescinded = await app.request(`/api/v1/airspace-authorizations/${authorization.authorizationId}`, {
        method: 'PATCH',
        headers: jsonHeaders,
        body: JSON.stringify({ status: 'rescinded' }),
      });
      expect(rescinded.status).toBe(200);
      const rescindedBody = await jsonBody<{ status: string; rescindedAt: string | null }>(rescinded);
      expect(rescindedBody.status).toBe('rescinded');
      expect(rescindedBody.rescindedAt).not.toBeNull();

      const afterRescinded = await app.request(`/api/v1/airspace-authorizations/${authorization.authorizationId}`, {
        method: 'PATCH',
        headers: jsonHeaders,
        body: JSON.stringify({ status: 'approved' }),
      });
      expect(afterRescinded.status).toBe(409);
    });

    test('lifecycle immutability: proposed is freely patchable, approved only accepts a pure rescind, rescinded accepts nothing', async () => {
      const created = await app.request('/api/v1/airspace-authorizations', {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({ ...authorization, authorizationId: 'fasit-auth-lifecycle' }),
      });
      expect(created.status).toBe(201);
      const id = 'fasit-auth-lifecycle';

      // proposed: any field, including combined with a status change, is patchable
      const proposedPatch = await app.request(`/api/v1/airspace-authorizations/${id}`, {
        method: 'PATCH',
        headers: jsonHeaders,
        body: JSON.stringify({ maxAltitudeFt: 300 }),
      });
      expect(proposedPatch.status).toBe(200);
      expect((await jsonBody<{ maxAltitudeFt: number }>(proposedPatch)).maxAltitudeFt).toBe(300);

      const approved = await app.request(`/api/v1/airspace-authorizations/${id}`, {
        method: 'PATCH',
        headers: jsonHeaders,
        body: JSON.stringify({ status: 'approved' }),
      });
      expect(approved.status).toBe(200);

      // approved: a non-status field alone is rejected
      const approvedNonStatus = await app.request(`/api/v1/airspace-authorizations/${id}`, {
        method: 'PATCH',
        headers: jsonHeaders,
        body: JSON.stringify({ maxAltitudeFt: 500 }),
      });
      expect(approvedNonStatus.status).toBe(409);

      // approved: status + another field combined is rejected (not a *pure* rescind)
      const approvedCombined = await app.request(`/api/v1/airspace-authorizations/${id}`, {
        method: 'PATCH',
        headers: jsonHeaders,
        body: JSON.stringify({ status: 'rescinded', maxAltitudeFt: 500 }),
      });
      expect(approvedCombined.status).toBe(409);

      // approved: maxAltitudeFt must still be untouched by either rejected attempt above
      const stillApproved = await app.request(`/api/v1/airspace-authorizations/${id}`);
      expect((await jsonBody<{ maxAltitudeFt: number; status: string }>(stillApproved)).maxAltitudeFt).toBe(300);

      // approved: a pure rescind is the one patch still allowed
      const rescinded = await app.request(`/api/v1/airspace-authorizations/${id}`, {
        method: 'PATCH',
        headers: jsonHeaders,
        body: JSON.stringify({ status: 'rescinded' }),
      });
      expect(rescinded.status).toBe(200);

      // rescinded: even a non-status field alone is rejected — fully immutable
      const rescindedNonStatus = await app.request(`/api/v1/airspace-authorizations/${id}`, {
        method: 'PATCH',
        headers: jsonHeaders,
        body: JSON.stringify({ maxAltitudeFt: 999 }),
      });
      expect(rescindedNonStatus.status).toBe(409);
    });

    test('concurrent rescind PATCHes on the same authorization: exactly one wins, the other 409s', async () => {
      const created = await app.request('/api/v1/airspace-authorizations', {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({ ...authorization, authorizationId: 'fasit-auth-concurrent-rescind' }),
      });
      expect(created.status).toBe(201);

      const patchRescind = () =>
        app.request(`/api/v1/airspace-authorizations/fasit-auth-concurrent-rescind`, {
          method: 'PATCH',
          headers: jsonHeaders,
          body: JSON.stringify({ status: 'rescinded' }),
        });
      const [first, second] = await Promise.all([patchRescind(), patchRescind()]);
      const statuses = [first.status, second.status].sort();
      expect(statuses).toEqual([200, 409]);

      const fetched = await app.request('/api/v1/airspace-authorizations/fasit-auth-concurrent-rescind');
      const body = await jsonBody<{ status: string; rescindedAt: string | null }>(fetched);
      expect(body.status).toBe('rescinded');
      expect(body.rescindedAt).not.toBeNull();
    });

    test('PATCH 404s for an unknown authorization', async () => {
      const res = await app.request('/api/v1/airspace-authorizations/no-such-auth', {
        method: 'PATCH',
        headers: jsonHeaders,
        body: JSON.stringify({ status: 'approved' }),
      });
      expect(res.status).toBe(404);
    });
  });

  describe('flight plans', () => {
    const waypointsPlan = {
      flightPlanId: 'fasit-plan-waypoints',
      planType: 'waypoints',
      ownerId: 'fasit-owner-1',
      registrationId: 'fasit-reg-1',
      pilotId: null,
      airspaceAuthorizationId: null,
      startTime: '2026-08-01T14:30:00.000Z',
      endTime: '2026-08-01T15:30:00.000Z',
      waypoints: [
        { latitude: 47.615, longitude: -122.415, altitudeMinFt: 250, altitudeMaxFt: 350, radiusMeters: 50 },
        { latitude: 47.62, longitude: -122.405, altitudeMinFt: 300, altitudeMaxFt: 400, radiusMeters: 50 },
      ],
    };

    const polygonPlan = {
      flightPlanId: 'fasit-plan-polygon',
      planType: 'polygon',
      ownerId: 'fasit-owner-1',
      registrationId: null,
      pilotId: null,
      airspaceAuthorizationId: null,
      startTime: '2026-08-01T16:00:00.000Z',
      endTime: '2026-08-01T17:00:00.000Z',
      polygonArea: {
        type: 'Polygon',
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

    test('422s for an unknown ownerId', async () => {
      const res = await app.request('/api/v1/flight-plans', {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({ ...waypointsPlan, ownerId: 'no-such-owner' }),
      });
      expect(res.status).toBe(422);
    });

    test('422s when registrationId belongs to a different owner', async () => {
      const res = await app.request('/api/v1/flight-plans', {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({ ...waypointsPlan, registrationId: 'fasit-reg-other' }),
      });
      expect(res.status).toBe(422);
    });

    test("404s for an airspaceAuthorizationId that doesn't exist", async () => {
      const res = await app.request('/api/v1/flight-plans', {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({ ...waypointsPlan, airspaceAuthorizationId: 'no-such-auth' }),
      });
      expect(res.status).toBe(404);
    });

    test('creates a waypoints-shaped plan, rejects a duplicate id, and round-trips waypoints in order', async () => {
      const created = await app.request('/api/v1/flight-plans', {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify(waypointsPlan),
      });
      expect(created.status).toBe(201);

      const duplicate = await app.request('/api/v1/flight-plans', {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify(waypointsPlan),
      });
      expect(duplicate.status).toBe(409);

      const fetched = await app.request(`/api/v1/flight-plans/${waypointsPlan.flightPlanId}`);
      expect(fetched.status).toBe(200);
      const fetchedBody = await jsonBody<{ planType: string; waypoints: { latitude: number; longitude: number }[] }>(
        fetched,
      );
      expect(fetchedBody.planType).toBe('waypoints');
      expect(fetchedBody.waypoints).toHaveLength(2);
      expect(fetchedBody.waypoints[0]!.latitude).toBeCloseTo(47.615, 5);
      expect(fetchedBody.waypoints[1]!.latitude).toBeCloseTo(47.62, 5);
    });

    test('creates a polygon-shaped plan and round-trips its shape', async () => {
      const created = await app.request('/api/v1/flight-plans', {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify(polygonPlan),
      });
      expect(created.status).toBe(201);

      const fetched = await app.request(`/api/v1/flight-plans/${polygonPlan.flightPlanId}`);
      const fetchedBody = await jsonBody<{ planType: string; polygonMaxAltitudeFt: number }>(fetched);
      expect(fetchedBody.planType).toBe('polygon');
      expect(fetchedBody.polygonMaxAltitudeFt).toBe(250);
    });

    test('PATCH unlinks an airspaceAuthorizationId and 404s for an unknown plan', async () => {
      const unlinked = await app.request(`/api/v1/flight-plans/${waypointsPlan.flightPlanId}`, {
        method: 'PATCH',
        headers: jsonHeaders,
        body: JSON.stringify({ airspaceAuthorizationId: null }),
      });
      expect(unlinked.status).toBe(200);
      expect((await jsonBody<{ airspaceAuthorizationId: string | null }>(unlinked)).airspaceAuthorizationId).toBeNull();

      const notFound = await app.request('/api/v1/flight-plans/no-such-plan', {
        method: 'PATCH',
        headers: jsonHeaders,
        body: JSON.stringify({ startTime: '2026-08-01T14:00:00.000Z' }),
      });
      expect(notFound.status).toBe(404);
    });

    test('intersecting finds both shapes in an overlapping box, misses a disjoint one', async () => {
      const hit = await app.request(
        '/api/v1/flight-plans/intersecting?minLat=47.55&minLon=-122.45&maxLat=47.7&maxLon=-122.25',
      );
      expect(hit.status).toBe(200);
      const hitIds = (await jsonBody<{ flightPlanId: string }[]>(hit)).map((p) => p.flightPlanId);
      expect(hitIds).toContain(waypointsPlan.flightPlanId);
      expect(hitIds).toContain(polygonPlan.flightPlanId);

      const miss = await app.request('/api/v1/flight-plans/intersecting?minLat=10&minLon=10&maxLat=11&maxLon=11');
      expect((await jsonBody<unknown[]>(miss)).length).toBe(0);
    });

    test('intersecting altitudeFt band is exclusive of altitudeMinFt and inclusive of altitudeMaxFt', async () => {
      // A dedicated single-waypoint plan, rather than reusing waypointsPlan (which has a second
      // waypoint with a different altitude band that would otherwise also satisfy some of these
      // altitudeFt values and mask the boundary behavior being tested here).
      const altitudeBandPlan = {
        flightPlanId: 'fasit-plan-altitude-band',
        planType: 'waypoints',
        ownerId: 'fasit-owner-1',
        registrationId: 'fasit-reg-1',
        pilotId: null,
        airspaceAuthorizationId: null,
        startTime: '2026-08-01T18:00:00.000Z',
        endTime: '2026-08-01T19:00:00.000Z',
        waypoints: [{ latitude: 47.9, longitude: -122.9, altitudeMinFt: 250, altitudeMaxFt: 350, radiusMeters: 50 }],
      };
      const created = await app.request('/api/v1/flight-plans', {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify(altitudeBandPlan),
      });
      expect(created.status).toBe(201);

      const bbox = 'minLat=47.5&minLon=-123.5&maxLat=48.3&maxLon=-122.2';

      const atMin = await app.request(`/api/v1/flight-plans/intersecting?${bbox}&altitudeFt=250`);
      expect(atMin.status).toBe(200);
      const atMinIds = (await jsonBody<{ flightPlanId: string }[]>(atMin)).map((p) => p.flightPlanId);
      expect(atMinIds).not.toContain(altitudeBandPlan.flightPlanId);

      const atMax = await app.request(`/api/v1/flight-plans/intersecting?${bbox}&altitudeFt=350`);
      expect(atMax.status).toBe(200);
      const atMaxIds = (await jsonBody<{ flightPlanId: string }[]>(atMax)).map((p) => p.flightPlanId);
      expect(atMaxIds).toContain(altitudeBandPlan.flightPlanId);

      const justAboveMin = await app.request(`/api/v1/flight-plans/intersecting?${bbox}&altitudeFt=250.1`);
      const justAboveMinIds = (await jsonBody<{ flightPlanId: string }[]>(justAboveMin)).map((p) => p.flightPlanId);
      expect(justAboveMinIds).toContain(altitudeBandPlan.flightPlanId);

      const justAboveMax = await app.request(`/api/v1/flight-plans/intersecting?${bbox}&altitudeFt=350.1`);
      const justAboveMaxIds = (await jsonBody<{ flightPlanId: string }[]>(justAboveMax)).map((p) => p.flightPlanId);
      expect(justAboveMaxIds).not.toContain(altitudeBandPlan.flightPlanId);
    });
  });

  describe('waivers', () => {
    const pilotWaiver = {
      waiverId: 'fasit-waiver-pilot',
      waiverType: 'beyond_visual_line_of_sight',
      pilotId: 'fasit-pilot-1',
      ownerId: null,
      conditions: 'BVLOS operations limited to a 1200 ft AGL corridor.',
      startTime: '2026-08-01T00:00:00.000Z',
      endTime: '2027-08-01T00:00:00.000Z',
    };

    const ownerWaiver = {
      waiverId: 'fasit-waiver-owner',
      waiverType: 'operations_over_people',
      pilotId: null,
      ownerId: 'fasit-owner-org',
      conditions: 'Sustained flight over open-air assemblies permitted per attached Means of Compliance.',
      startTime: '2026-08-01T00:00:00.000Z',
      endTime: '2027-08-01T00:00:00.000Z',
    };

    test('422s for an unknown pilotId (standalone lookup)', async () => {
      const res = await app.request('/api/v1/waivers', {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({ ...pilotWaiver, pilotId: 'no-such-pilot' }),
      });
      expect(res.status).toBe(422);
    });

    test('creates a pilot-linked waiver and an owner-linked waiver, rejects a duplicate id', async () => {
      const createdPilot = await app.request('/api/v1/waivers', {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify(pilotWaiver),
      });
      expect(createdPilot.status).toBe(201);

      const createdOwner = await app.request('/api/v1/waivers', {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify(ownerWaiver),
      });
      expect(createdOwner.status).toBe(201);

      const duplicate = await app.request('/api/v1/waivers', {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify(pilotWaiver),
      });
      expect(duplicate.status).toBe(409);

      const listedByType = await app.request(`/api/v1/waivers?waiverType=${ownerWaiver.waiverType}`);
      const listedIds = (await jsonBody<{ waiverId: string }[]>(listedByType)).map((w) => w.waiverId);
      expect(listedIds).toContain(ownerWaiver.waiverId);
      expect(listedIds).not.toContain(pilotWaiver.waiverId);
    });

    test('status lifecycle: proposed -> approved -> rescinded, then a further status change 409s', async () => {
      const approved = await app.request(`/api/v1/waivers/${pilotWaiver.waiverId}`, {
        method: 'PATCH',
        headers: jsonHeaders,
        body: JSON.stringify({ status: 'approved' }),
      });
      expect(approved.status).toBe(200);

      const rescinded = await app.request(`/api/v1/waivers/${pilotWaiver.waiverId}`, {
        method: 'PATCH',
        headers: jsonHeaders,
        body: JSON.stringify({ status: 'rescinded' }),
      });
      expect(rescinded.status).toBe(200);
      expect((await jsonBody<{ rescindedAt: string | null }>(rescinded)).rescindedAt).not.toBeNull();

      const afterRescinded = await app.request(`/api/v1/waivers/${pilotWaiver.waiverId}`, {
        method: 'PATCH',
        headers: jsonHeaders,
        body: JSON.stringify({ status: 'approved' }),
      });
      expect(afterRescinded.status).toBe(409);
    });

    test('lifecycle immutability: proposed is freely patchable, approved only accepts a pure rescind, rescinded accepts nothing', async () => {
      const created = await app.request('/api/v1/waivers', {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({ ...ownerWaiver, waiverId: 'fasit-waiver-lifecycle' }),
      });
      expect(created.status).toBe(201);
      const id = 'fasit-waiver-lifecycle';

      // proposed: any field, including combined with a status change, is patchable
      const proposedPatch = await app.request(`/api/v1/waivers/${id}`, {
        method: 'PATCH',
        headers: jsonHeaders,
        body: JSON.stringify({ conditions: 'Updated while proposed.' }),
      });
      expect(proposedPatch.status).toBe(200);
      expect((await jsonBody<{ conditions: string }>(proposedPatch)).conditions).toBe('Updated while proposed.');

      const approved = await app.request(`/api/v1/waivers/${id}`, {
        method: 'PATCH',
        headers: jsonHeaders,
        body: JSON.stringify({ status: 'approved' }),
      });
      expect(approved.status).toBe(200);

      // approved: a non-status field alone is rejected
      const approvedNonStatus = await app.request(`/api/v1/waivers/${id}`, {
        method: 'PATCH',
        headers: jsonHeaders,
        body: JSON.stringify({ conditions: 'Should be rejected.' }),
      });
      expect(approvedNonStatus.status).toBe(409);

      // approved: status + another field combined is rejected (not a *pure* rescind)
      const approvedCombined = await app.request(`/api/v1/waivers/${id}`, {
        method: 'PATCH',
        headers: jsonHeaders,
        body: JSON.stringify({ status: 'rescinded', conditions: 'Should also be rejected.' }),
      });
      expect(approvedCombined.status).toBe(409);

      // approved: conditions must still be untouched by either rejected attempt above
      const stillApproved = await app.request(`/api/v1/waivers/${id}`);
      expect((await jsonBody<{ conditions: string }>(stillApproved)).conditions).toBe('Updated while proposed.');

      // approved: a pure rescind is the one patch still allowed
      const rescinded = await app.request(`/api/v1/waivers/${id}`, {
        method: 'PATCH',
        headers: jsonHeaders,
        body: JSON.stringify({ status: 'rescinded' }),
      });
      expect(rescinded.status).toBe(200);

      // rescinded: even a non-status field alone is rejected — fully immutable
      const rescindedNonStatus = await app.request(`/api/v1/waivers/${id}`, {
        method: 'PATCH',
        headers: jsonHeaders,
        body: JSON.stringify({ conditions: 'Should be rejected too.' }),
      });
      expect(rescindedNonStatus.status).toBe(409);
    });

    test('GET 404s for an unknown waiver', async () => {
      const res = await app.request('/api/v1/waivers/no-such-waiver');
      expect(res.status).toBe(404);
    });

    test('concurrent rescind PATCHes on the same waiver: exactly one wins, the other 409s', async () => {
      const created = await app.request('/api/v1/waivers', {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({ ...ownerWaiver, waiverId: 'fasit-waiver-concurrent-rescind' }),
      });
      expect(created.status).toBe(201);

      const patchRescind = () =>
        app.request(`/api/v1/waivers/fasit-waiver-concurrent-rescind`, {
          method: 'PATCH',
          headers: jsonHeaders,
          body: JSON.stringify({ status: 'rescinded' }),
        });
      const [first, second] = await Promise.all([patchRescind(), patchRescind()]);
      const statuses = [first.status, second.status].sort();
      expect(statuses).toEqual([200, 409]);

      const fetched = await app.request('/api/v1/waivers/fasit-waiver-concurrent-rescind');
      const body = await jsonBody<{ status: string; rescindedAt: string | null }>(fetched);
      expect(body.status).toBe('rescinded');
      expect(body.rescindedAt).not.toBeNull();
    });
  });
});
