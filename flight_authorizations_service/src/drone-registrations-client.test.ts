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

/** Mocks `fetch` to return `response` and records the URL each call was made with, for asserting on the request path built from a caller-supplied id. */
function mockFetchCapturingUrl(response: Response): { calls: string[] } {
  const calls: string[] = [];
  globalThis.fetch = mock(async (input: unknown) => {
    calls.push(String(input));
    return response;
  }) as unknown as typeof fetch;
  return { calls };
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

  test('percent-encodes an ownerId containing path-altering characters instead of splicing them into the URL', async () => {
    const { calls } = mockFetchCapturingUrl(new Response(null, { status: 404 }));
    await ownerExists('../../pilots');
    expect(calls[0]).toContain('/api/v1/owners/..%2F..%2Fpilots');
    expect(calls[0]).not.toContain('/api/v1/owners/../../pilots');
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

  test('percent-encodes ownerId/pilotId containing path-altering characters', async () => {
    const { calls } = mockFetchCapturingUrl(new Response(null, { status: 404 }));
    await pilotExistsUnderOwner('owner/1', 'pilot?x=1');
    expect(calls[0]).toContain('/api/v1/owners/owner%2F1/pilots/pilot%3Fx%3D1');
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

  test('percent-encodes a pilotId containing path-altering characters', async () => {
    const { calls } = mockFetchCapturingUrl(new Response(null, { status: 404 }));
    await pilotExistsStandalone('pilot#frag');
    expect(calls[0]).toContain('/api/v1/pilots/pilot%23frag');
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

  test('percent-encodes a registrationId containing path-altering characters', async () => {
    const { calls } = mockFetchCapturingUrl(new Response(null, { status: 404 }));
    await getRegistrationOwnerId('reg/../owners');
    expect(calls[0]).toContain('/api/v1/drone-registrations/reg%2F..%2Fowners');
  });
});
