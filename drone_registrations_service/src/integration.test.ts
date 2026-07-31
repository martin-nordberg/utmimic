import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { app } from './app';
import { sql } from './db';
import { resetSchema } from './test-support/reset-db';

async function jsonBody<T = Record<string, unknown>>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

const jsonHeaders = { 'Content-Type': 'application/json' };

beforeAll(async () => {
  await resetSchema();
});

afterAll(async () => {
  await sql.close();
});

describe('drone_registrations_service (end-to-end)', () => {
  test('rejects a body-carrying request with the wrong Content-Type', async () => {
    const res = await app.request('/api/v1/owners', {
      method: 'POST',
      body: JSON.stringify({
        ownerId: 'wrong-content-type-owner',
        ownerType: 'individual',
        firstName: 'A',
        lastName: 'B',
        phoneNumber: '+1-555-0000',
        addressLine1: '1 St',
        addressCity: 'City',
        addressState: 'ST',
        addressZip: '00000',
        email: 'a@example.com',
      }),
    });
    expect(res.status).toBe(415);

    const getRes = await app.request('/api/v1/owners/wrong-content-type-owner');
    expect(getRes.status).toBe(404);
  });

  test('rejects syntactically-broken JSON with a { message } JSON body, not a plain-text one', async () => {
    const res = await app.request('/api/v1/owners', {
      method: 'POST',
      headers: jsonHeaders,
      body: '{not valid json',
    });
    expect(res.status).toBe(400);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(await jsonBody<{ message: string }>(res)).toEqual({ message: 'Malformed JSON in request body' });
  });

  test('validation failures return { message } like every other error, not the default ZodError shape', async () => {
    const res = await app.request('/api/v1/owners', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ ownerType: 'individual' }),
    });
    expect(res.status).toBe(400);
    const body = await jsonBody<{ message: string }>(res);
    expect(typeof body.message).toBe('string');
    expect(body).not.toHaveProperty('success');
    expect(body).not.toHaveProperty('error');
  });

  test('registers an individual and an organization owner', async () => {
    const individualRes = await app.request('/api/v1/owners', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({
        ownerId: 'it-owner-individual',
        ownerType: 'individual',
        firstName: 'Jane',
        lastName: 'Doe',
        phoneNumber: '+1-555-0101',
        addressLine1: '1 Elm St',
        addressCity: 'Springfield',
        addressState: 'ST',
        addressZip: '00001',
        email: 'jane@example.com',
      }),
    });
    expect(individualRes.status).toBe(201);

    const organizationRes = await app.request('/api/v1/owners', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({
        ownerId: 'it-owner-org',
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
      }),
    });
    expect(organizationRes.status).toBe(201);
  });

  test('rejects registering the same ownerId twice', async () => {
    const res = await app.request('/api/v1/owners', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({
        ownerId: 'it-owner-individual',
        ownerType: 'individual',
        firstName: 'Duplicate',
        lastName: 'Owner',
        phoneNumber: '+1-555-0102',
        addressLine1: '2 Elm St',
        addressCity: 'Springfield',
        addressState: 'ST',
        addressZip: '00001',
        email: 'dup@example.com',
      }),
    });
    expect(res.status).toBe(409);
  });

  test('GET /owners lists all registered owners', async () => {
    const res = await app.request('/api/v1/owners');
    expect(res.status).toBe(200);
    const ownerIds = (await jsonBody<{ ownerId: string }[]>(res)).map((o) => o.ownerId);
    expect(ownerIds).toContain('it-owner-individual');
    expect(ownerIds).toContain('it-owner-org');
  });

  test('GET /owners/{ownerId} fetches a single owner', async () => {
    const res = await app.request('/api/v1/owners/it-owner-individual');
    expect(res.status).toBe(200);
    const body = await jsonBody<{ ownerId: string; firstName: string }>(res);
    expect(body.ownerId).toBe('it-owner-individual');
    expect(body.firstName).toBe('Jane');
  });

  test('PATCH /owners/{ownerId} partially updates an owner, and 404s for an unknown owner', async () => {
    const res = await app.request('/api/v1/owners/it-owner-individual', {
      method: 'PATCH',
      headers: jsonHeaders,
      body: JSON.stringify({ phoneNumber: '+1-555-9999' }),
    });
    expect(res.status).toBe(200);
    const body = await jsonBody<{ phoneNumber: string; firstName: string }>(res);
    expect(body.phoneNumber).toBe('+1-555-9999');
    expect(body.firstName).toBe('Jane');

    const unknown = await app.request('/api/v1/owners/no-such-owner', {
      method: 'PATCH',
      headers: jsonHeaders,
      body: JSON.stringify({ phoneNumber: '+1-555-0000' }),
    });
    expect(unknown.status).toBe(404);
  });

  test('adding a pilot under an individual owner 422s', async () => {
    const res = await app.request('/api/v1/owners/it-owner-individual/pilots', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({
        pilotId: 'it-pilot-rejected',
        name: 'Should Fail',
        phoneNumber: '+1-555-0199',
        licenseNumber: 'REM-0000000',
      }),
    });
    expect(res.status).toBe(422);
  });

  test('adding a pilot under an organization owner succeeds', async () => {
    const res = await app.request('/api/v1/owners/it-owner-org/pilots', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({
        pilotId: 'it-pilot-1',
        name: 'John Pilot',
        phoneNumber: '+1-555-0102',
        licenseNumber: 'REM-1234567',
      }),
    });
    expect(res.status).toBe(201);
  });

  test('rejects adding the same pilotId twice', async () => {
    const res = await app.request('/api/v1/owners/it-owner-org/pilots', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({
        pilotId: 'it-pilot-1',
        name: 'Someone Else',
        phoneNumber: '+1-555-0103',
        licenseNumber: 'REM-7654321',
      }),
    });
    expect(res.status).toBe(409);
  });

  test('GET /owners/{ownerId}/pilots lists an owner\'s pilots', async () => {
    const res = await app.request('/api/v1/owners/it-owner-org/pilots');
    expect(res.status).toBe(200);
    const pilotIds = (await jsonBody<{ pilotId: string }[]>(res)).map((p) => p.pilotId);
    expect(pilotIds).toContain('it-pilot-1');
  });

  test('GET /owners/{ownerId}/pilots/{pilotId} fetches a single pilot scoped to its owner', async () => {
    const res = await app.request('/api/v1/owners/it-owner-org/pilots/it-pilot-1');
    expect(res.status).toBe(200);
    const body = await jsonBody<{ pilotId: string; name: string }>(res);
    expect(body.pilotId).toBe('it-pilot-1');
    expect(body.name).toBe('John Pilot');

    const wrongOwner = await app.request('/api/v1/owners/it-owner-individual/pilots/it-pilot-1');
    expect(wrongOwner.status).toBe(404);

    const unknown = await app.request('/api/v1/owners/it-owner-org/pilots/no-such-pilot');
    expect(unknown.status).toBe(404);
  });

  test('PATCH /owners/{ownerId}/pilots/{pilotId} partially updates a pilot, and 404s for an unknown pilot', async () => {
    const res = await app.request('/api/v1/owners/it-owner-org/pilots/it-pilot-1', {
      method: 'PATCH',
      headers: jsonHeaders,
      body: JSON.stringify({ phoneNumber: '+1-555-8888' }),
    });
    expect(res.status).toBe(200);
    const body = await jsonBody<{ phoneNumber: string; name: string }>(res);
    expect(body.phoneNumber).toBe('+1-555-8888');
    expect(body.name).toBe('John Pilot');

    const unknown = await app.request('/api/v1/owners/it-owner-org/pilots/no-such-pilot', {
      method: 'PATCH',
      headers: jsonHeaders,
      body: JSON.stringify({ phoneNumber: '+1-555-0000' }),
    });
    expect(unknown.status).toBe(404);
  });

  test('fetches a pilot by id alone, without needing its owner id', async () => {
    const res = await app.request('/api/v1/pilots/it-pilot-1');
    expect(res.status).toBe(200);
    const body = await jsonBody<{ pilotId: string; organizationOwnerId: string }>(res);
    expect(body.pilotId).toBe('it-pilot-1');
    expect(body.organizationOwnerId).toBe('it-owner-org');

    const unknown = await app.request('/api/v1/pilots/no-such-pilot');
    expect(unknown.status).toBe(404);
  });

  test('deletes a pilot, then 404s deleting it again or an unknown pilot', async () => {
    const created = await app.request('/api/v1/owners/it-owner-org/pilots', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({
        pilotId: 'it-pilot-delete-me',
        name: 'To Be Deleted',
        phoneNumber: '+1-555-0104',
        licenseNumber: 'REM-2222222',
      }),
    });
    expect(created.status).toBe(201);

    const deleted = await app.request('/api/v1/owners/it-owner-org/pilots/it-pilot-delete-me', { method: 'DELETE' });
    expect(deleted.status).toBe(204);

    const deletedAgain = await app.request('/api/v1/owners/it-owner-org/pilots/it-pilot-delete-me', {
      method: 'DELETE',
    });
    expect(deletedAgain.status).toBe(404);

    const unknownPilot = await app.request('/api/v1/owners/it-owner-org/pilots/no-such-pilot', { method: 'DELETE' });
    expect(unknownPilot.status).toBe(404);

    const wrongOwner = await app.request('/api/v1/owners/it-owner-individual/pilots/it-pilot-1', {
      method: 'DELETE',
    });
    expect(wrongOwner.status).toBe(404);

    // it-pilot-1 (a different pilot, under the correct owner) must still exist — the wrong-owner
    // DELETE attempt above must not have deleted it.
    const stillThere = await app.request('/api/v1/pilots/it-pilot-1');
    expect(stillThere.status).toBe(200);
  });

  test('creates two non-overlapping registrations for the same serial number, and rejects an overlapping third', async () => {
    const first = await app.request('/api/v1/drone-registrations', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({
        registrationId: 'it-reg-1',
        serialNumber: 'IT-SN-1',
        make: 'DJI',
        modelNumber: 'Mavic 3',
        ownerId: 'it-owner-individual',
        startDate: '2026-01-01',
        endDate: '2026-06-30',
      }),
    });
    expect(first.status).toBe(201);

    const second = await app.request('/api/v1/drone-registrations', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({
        registrationId: 'it-reg-2',
        serialNumber: 'IT-SN-1',
        make: 'DJI',
        modelNumber: 'Mavic 3',
        ownerId: 'it-owner-individual',
        startDate: '2026-08-01',
        endDate: '2026-12-31',
      }),
    });
    expect(second.status).toBe(201);

    const overlapping = await app.request('/api/v1/drone-registrations', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({
        registrationId: 'it-reg-overlap',
        serialNumber: 'IT-SN-1',
        make: 'DJI',
        modelNumber: 'Mavic 3',
        ownerId: 'it-owner-individual',
        startDate: '2026-06-01',
        endDate: '2026-08-15',
      }),
    });
    expect(overlapping.status).toBe(409);
  });

  test('rejects registering the same registrationId twice', async () => {
    const res = await app.request('/api/v1/drone-registrations', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({
        registrationId: 'it-reg-1',
        serialNumber: 'IT-SN-9',
        make: 'DJI',
        modelNumber: 'X',
        ownerId: 'it-owner-individual',
        startDate: '2027-01-01',
        endDate: '2027-02-01',
      }),
    });
    expect(res.status).toBe(409);
  });

  test('GET /drone-registrations lists registrations, optionally filtered by serialNumber/ownerId', async () => {
    const fullList = await app.request('/api/v1/drone-registrations');
    expect(fullList.status).toBe(200);
    const allIds = (await jsonBody<{ registrationId: string }[]>(fullList)).map((r) => r.registrationId);
    expect(allIds).toContain('it-reg-1');
    expect(allIds).toContain('it-reg-2');

    const bySerial = await app.request('/api/v1/drone-registrations?serialNumber=IT-SN-1');
    expect(bySerial.status).toBe(200);
    const bySerialIds = (await jsonBody<{ registrationId: string }[]>(bySerial)).map((r) => r.registrationId);
    expect(bySerialIds.sort()).toEqual(['it-reg-1', 'it-reg-2'].sort());

    const byOwner = await app.request('/api/v1/drone-registrations?ownerId=it-owner-individual');
    expect(byOwner.status).toBe(200);
    const byOwnerIds = (await jsonBody<{ registrationId: string }[]>(byOwner)).map((r) => r.registrationId);
    expect(byOwnerIds).toContain('it-reg-1');
  });

  test('GET /drone-registrations/{registrationId} fetches a single registration, and 404s for an unknown one', async () => {
    const res = await app.request('/api/v1/drone-registrations/it-reg-1');
    expect(res.status).toBe(200);
    const body = await jsonBody<{ registrationId: string; serialNumber: string }>(res);
    expect(body.registrationId).toBe('it-reg-1');
    expect(body.serialNumber).toBe('IT-SN-1');

    const unknown = await app.request('/api/v1/drone-registrations/no-such-registration');
    expect(unknown.status).toBe(404);
  });

  test('rejects registering a drone under a nonexistent owner', async () => {
    const res = await app.request('/api/v1/drone-registrations', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({
        registrationId: 'it-reg-no-owner',
        serialNumber: 'IT-SN-NO-OWNER',
        make: 'DJI',
        modelNumber: 'X',
        ownerId: 'no-such-owner',
        startDate: '2027-01-01',
        endDate: '2027-02-01',
      }),
    });
    expect(res.status).toBe(404);
  });

  test('PATCHing a date into an overlap 409s', async () => {
    const res = await app.request('/api/v1/drone-registrations/it-reg-2', {
      method: 'PATCH',
      headers: jsonHeaders,
      body: JSON.stringify({ startDate: '2026-06-15' }),
    });
    expect(res.status).toBe(409);
  });

  test('by-serial resolves the right registration across a gap between two registrations', async () => {
    const inFirst = await app.request('/api/v1/drone-registrations/by-serial/IT-SN-1?asOf=2026-03-01');
    expect(inFirst.status).toBe(200);
    expect((await jsonBody<{ registrationId: string }>(inFirst)).registrationId).toBe('it-reg-1');

    const inSecond = await app.request('/api/v1/drone-registrations/by-serial/IT-SN-1?asOf=2026-09-01');
    expect(inSecond.status).toBe(200);
    expect((await jsonBody<{ registrationId: string }>(inSecond)).registrationId).toBe('it-reg-2');

    const inGap = await app.request('/api/v1/drone-registrations/by-serial/IT-SN-1?asOf=2026-07-15');
    expect(inGap.status).toBe(404);
  });

  test("an owner's drone-registrations across multiple drones: full list, asOf narrowing, and 404 for an unknown owner", async () => {
    const secondDrone = await app.request('/api/v1/drone-registrations', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({
        registrationId: 'it-reg-3',
        serialNumber: 'IT-SN-2',
        make: 'DJI',
        modelNumber: 'Mini 4',
        ownerId: 'it-owner-individual',
        startDate: '2026-02-01',
        endDate: '2026-09-30',
      }),
    });
    expect(secondDrone.status).toBe(201);

    const fullList = await app.request('/api/v1/owners/it-owner-individual/drone-registrations');
    expect(fullList.status).toBe(200);
    const fullRegistrationIds = (await jsonBody<{ registrationId: string }[]>(fullList)).map((r) => r.registrationId);
    expect(fullRegistrationIds.sort()).toEqual(['it-reg-1', 'it-reg-2', 'it-reg-3'].sort());

    const narrowed = await app.request('/api/v1/owners/it-owner-individual/drone-registrations?asOf=2026-03-01');
    expect(narrowed.status).toBe(200);
    const narrowedRegistrationIds = (await jsonBody<{ registrationId: string }[]>(narrowed)).map(
      (r) => r.registrationId,
    );
    expect(narrowedRegistrationIds.sort()).toEqual(['it-reg-1', 'it-reg-3'].sort());

    const unknownOwner = await app.request('/api/v1/owners/no-such-owner/drone-registrations');
    expect(unknownOwner.status).toBe(404);
  });
});
