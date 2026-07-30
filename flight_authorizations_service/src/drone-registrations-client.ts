import { config } from './config';

/**
 * Thrown when Drone Registrations Service can't be reached at all (a network error) or
 * responds with a `5xx` status — this service's own dependency being down, not "the ID doesn't
 * exist." Route handlers map this to `503`, distinct from the `422`s used for a missing ID (see
 * the implementation plan's Decisions already resolved section).
 */
export class DroneRegistrationsServiceUnavailableError extends Error {
  constructor(detail: string) {
    super(`Drone Registrations Service unavailable: ${detail}`);
  }
}

/** GETs a path under Drone Registrations Service's base URL, classifying network errors and `5xx` responses as {@link DroneRegistrationsServiceUnavailableError}. Callers interpret the remaining status codes (`200`/`404`/etc.) themselves. */
async function get(path: string): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(`${config.DRONE_REGISTRATIONS_SERVICE_URL}${path}`);
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
  const res = await get(`/api/v1/owners/${ownerId}`);
  return res.status === 200;
}

/** Whether a pilot with this id exists under the given owner (`GET /api/v1/owners/{ownerId}/pilots/{pilotId}`) — covers both "pilot doesn't exist" and "pilot belongs to a different owner" in one check, per the spec. */
export async function pilotExistsUnderOwner(ownerId: string, pilotId: string): Promise<boolean> {
  const res = await get(`/api/v1/owners/${ownerId}/pilots/${pilotId}`);
  return res.status === 200;
}

/** Whether a pilot with this id exists, without scoping to a known owner (`GET /api/v1/pilots/{pilotId}`) — used for waivers, which store only a bare `pilotId` with no `ownerId` alongside it. */
export async function pilotExistsStandalone(pilotId: string): Promise<boolean> {
  const res = await get(`/api/v1/pilots/${pilotId}`);
  return res.status === 200;
}

/** The `ownerId` of the drone registration with this id, or `null` if no such registration exists (`GET /api/v1/drone-registrations/{registrationId}`). */
export async function getRegistrationOwnerId(registrationId: string): Promise<string | null> {
  const res = await get(`/api/v1/drone-registrations/${registrationId}`);
  if (res.status === 404) return null;
  const body = (await res.json()) as { ownerId: string };
  return body.ownerId;
}
