import { afterEach, describe, expect, mock, test } from 'bun:test';
import {
  DroneRegistrationsServiceUnavailableError,
  getRegistrationOwnerId,
  ownerExists,
  pilotExistsStandalone,
  pilotExistsUnderOwner,
} from './drone-registrations-client';

// This is the only module in the service's test suite that mocks anything — everywhere else
// tests run against real Postgres, per the project's preference for real dependencies. That
// preference doesn't extend to a genuinely different service's network calls: there's no real
// Drone Registrations Service instance to depend on here, only this module's own status-code
// branching, so a mocked `fetch` is the right boundary.
const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function mockFetchResponse(response: Response) {
  globalThis.fetch = mock(async () => response) as unknown as typeof fetch;
}

function mockFetchRejection(err: unknown) {
  globalThis.fetch = mock(async () => {
    throw err;
  }) as unknown as typeof fetch;
}

describe('ownerExists', () => {
  test('true on 200', async () => {
    mockFetchResponse(new Response(null, { status: 200 }));
    expect(await ownerExists('owner-1')).toBe(true);
  });

  test('false on 404', async () => {
    mockFetchResponse(new Response(null, { status: 404 }));
    expect(await ownerExists('owner-1')).toBe(false);
  });

  test('throws DroneRegistrationsServiceUnavailableError on a 5xx response', async () => {
    mockFetchResponse(new Response(null, { status: 503 }));
    await expect(ownerExists('owner-1')).rejects.toThrow(DroneRegistrationsServiceUnavailableError);
  });

  test('throws DroneRegistrationsServiceUnavailableError when fetch itself rejects', async () => {
    mockFetchRejection(new Error('ECONNREFUSED'));
    await expect(ownerExists('owner-1')).rejects.toThrow(DroneRegistrationsServiceUnavailableError);
  });
});

describe('pilotExistsUnderOwner', () => {
  test('true on 200', async () => {
    mockFetchResponse(new Response(null, { status: 200 }));
    expect(await pilotExistsUnderOwner('owner-1', 'pilot-1')).toBe(true);
  });

  test('false on 404', async () => {
    mockFetchResponse(new Response(null, { status: 404 }));
    expect(await pilotExistsUnderOwner('owner-1', 'pilot-1')).toBe(false);
  });
});

describe('pilotExistsStandalone', () => {
  test('true on 200', async () => {
    mockFetchResponse(new Response(null, { status: 200 }));
    expect(await pilotExistsStandalone('pilot-1')).toBe(true);
  });

  test('false on 404', async () => {
    mockFetchResponse(new Response(null, { status: 404 }));
    expect(await pilotExistsStandalone('pilot-1')).toBe(false);
  });
});

describe('getRegistrationOwnerId', () => {
  test('returns ownerId on 200', async () => {
    mockFetchResponse(new Response(JSON.stringify({ ownerId: 'owner-9' }), { status: 200 }));
    expect(await getRegistrationOwnerId('reg-1')).toBe('owner-9');
  });

  test('returns null on 404', async () => {
    mockFetchResponse(new Response(null, { status: 404 }));
    expect(await getRegistrationOwnerId('reg-1')).toBeNull();
  });
});
