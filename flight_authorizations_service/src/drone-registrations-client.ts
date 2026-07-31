import { z } from 'zod';
import { config } from './config';

/** Shape this service actually reads off a drone-registration lookup response — just enough to catch a malformed/schema-drifted body rather than silently treating a missing `ownerId` as `undefined`. */
const RegistrationResponseSchema = z.object({ ownerId: z.string() });

/**
 * Thrown when Drone Registrations Service can't be reached at all (a network error, or no
 * response within {@link REQUEST_TIMEOUT_MS}) or responds with a `5xx` status — this service's
 * own dependency being down, not "the ID doesn't exist." Route handlers map this to `503`,
 * distinct from the `422`s used for a missing ID (see the implementation plan's Decisions
 * already resolved section).
 */
export class DroneRegistrationsServiceUnavailableError extends Error {
  constructor(detail: string) {
    super(`Drone Registrations Service unavailable: ${detail}`);
  }
}

// A connection attempt to a port nothing is listening on was observed to hang indefinitely in
// this environment rather than rejecting with ECONNREFUSED (confirmed with a bare `fetch` against
// a stopped Drone Registrations Service instance) — without a bound, a single unreachable
// dependency call would hang this service's own request handling forever instead of surfacing
// the 503 the plan's resolved decision calls for. AbortSignal.timeout enforces that bound.
/** Max time to wait for a Drone Registrations Service response before treating it as unavailable. */
const REQUEST_TIMEOUT_MS = 5000;

/** GETs a path under Drone Registrations Service's base URL, classifying network errors, timeouts, and `5xx` responses as {@link DroneRegistrationsServiceUnavailableError}. Callers interpret the remaining status codes (`200`/`404`/etc.) themselves. */
async function get(path: string): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(`${config.DRONE_REGISTRATIONS_SERVICE_URL}${path}`, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    throw new DroneRegistrationsServiceUnavailableError(`request to ${path} failed: ${String(err)}`);
  }
  if (res.status >= 500) {
    throw new DroneRegistrationsServiceUnavailableError(`${path} returned ${res.status}`);
  }
  return res;
}

/** Whether an owner with this id exists in Drone Registrations Service (`GET /api/v1/owners/{ownerId}`). */
export async function ownerExists(ownerId: string): Promise<boolean> {
  const res = await get(`/api/v1/owners/${encodeURIComponent(ownerId)}`);
  return res.status === 200;
}

/** Whether a pilot with this id exists under the given owner (`GET /api/v1/owners/{ownerId}/pilots/{pilotId}`) — covers both "pilot doesn't exist" and "pilot belongs to a different owner" in one check, per the spec. */
export async function pilotExistsUnderOwner(ownerId: string, pilotId: string): Promise<boolean> {
  const res = await get(`/api/v1/owners/${encodeURIComponent(ownerId)}/pilots/${encodeURIComponent(pilotId)}`);
  return res.status === 200;
}

/** Whether a pilot with this id exists, without scoping to a known owner (`GET /api/v1/pilots/{pilotId}`) — used for waivers, which store only a bare `pilotId` with no `ownerId` alongside it. */
export async function pilotExistsStandalone(pilotId: string): Promise<boolean> {
  const res = await get(`/api/v1/pilots/${encodeURIComponent(pilotId)}`);
  return res.status === 200;
}

/**
 * The `ownerId` of the drone registration with this id, or `null` if no such registration exists
 * (`GET /api/v1/drone-registrations/{registrationId}`). Throws
 * `DroneRegistrationsServiceUnavailableError` — the same error used for network failures and
 * `5xx`s — if the `2xx` response body isn't valid JSON or doesn't have the expected shape,
 * rather than propagating a raw parse exception or silently returning `undefined` as if it were
 * a real owner id.
 */
export async function getRegistrationOwnerId(registrationId: string): Promise<string | null> {
  const path = `/api/v1/drone-registrations/${encodeURIComponent(registrationId)}`;
  const res = await get(path);
  if (res.status === 404) return null;

  let json: unknown;
  try {
    json = await res.json();
  } catch (err) {
    throw new DroneRegistrationsServiceUnavailableError(`${path} returned a non-JSON body: ${String(err)}`);
  }
  const parsed = RegistrationResponseSchema.safeParse(json);
  if (!parsed.success) {
    throw new DroneRegistrationsServiceUnavailableError(`${path} returned an unexpected response shape`);
  }
  return parsed.data.ownerId;
}
