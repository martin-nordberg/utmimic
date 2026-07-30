import { SQL } from 'bun';
import { sql } from '../db';
import { ownerExists, pilotExistsUnderOwner } from '../drone-registrations-client';
import { containsPoint, geomFromGeoJson, intersectsEnvelope } from '../geo';
import type { Polygon } from '../schemas/geojson';

/** Airspace authorization lifecycle status, matching the table's CHECK constraint. */
export type AirspaceAuthorizationStatus = 'proposed' | 'approved' | 'rescinded';

/** A persisted airspace authorization, as returned to API clients. */
export interface AirspaceAuthorizationRecord {
  authorizationId: string;
  area: Polygon;
  maxAltitudeFt: number;
  startTime: string;
  endTime: string;
  ownerId: string;
  pilotId: string | null;
  status: AirspaceAuthorizationStatus;
  rescindedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Fields required to create a new airspace authorization. */
export interface CreateAirspaceAuthorizationInput {
  authorizationId: string;
  area: Polygon;
  maxAltitudeFt: number;
  startTime: string;
  endTime: string;
  ownerId: string;
  pilotId?: string | null;
}

// pilotId is nullable and independently patchable (narrow to a pilot, or broaden back to the
// whole owner by clearing it) — see updateAirspaceAuthorization's handling of `'pilotId' in patch`
// below, which distinguishes "omitted, leave alone" from "explicitly null, clear it" the way a
// plain COALESCE can't.
/** Fields to partially update on an existing airspace authorization; `area`/`ownerId` are immutable. */
export interface AirspaceAuthorizationPatch {
  maxAltitudeFt?: number;
  startTime?: string;
  endTime?: string;
  pilotId?: string | null;
  status?: AirspaceAuthorizationStatus;
}

/** Optional filters for listing authorizations, AND'd together. */
export interface ListAirspaceAuthorizationsFilter {
  ownerId?: string;
  pilotId?: string;
  activeAt?: string;
  status?: AirspaceAuthorizationStatus;
}

/** Thrown when creating an authorization whose id already exists. */
export class AuthorizationAlreadyExistsError extends Error {
  constructor(authorizationId: string) {
    super(`Airspace authorization ${authorizationId} already exists`);
  }
}

/** Thrown when the given `ownerId` doesn't exist in Drone Registrations Service. */
export class OwnerNotFoundError extends Error {
  constructor(ownerId: string) {
    super(`Owner ${ownerId} not found`);
  }
}

/** Thrown when the given `pilotId` doesn't exist under the authorization's owner in Drone Registrations Service. */
export class PilotNotFoundError extends Error {
  constructor(pilotId: string) {
    super(`Pilot ${pilotId} not found`);
  }
}

/** Thrown when a `status` change is attempted on an authorization that's already `'rescinded'` — terminal, per the spec. */
export class RescindedIsTerminalError extends Error {
  constructor(authorizationId: string) {
    super(`Airspace authorization ${authorizationId} is rescinded and cannot change status further`);
  }
}

/** Raw `airspace_authorizations` table row shape (with `area` already converted to GeoJSON by the query), before mapping to `AirspaceAuthorizationRecord`. */
interface AirspaceAuthorizationRow {
  authorization_id: string;
  area: Polygon;
  max_altitude_ft: number;
  start_time: Date;
  end_time: Date;
  owner_id: string;
  pilot_id: string | null;
  status: AirspaceAuthorizationStatus;
  rescinded_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

/** Columns selected by every query below, converting `area` to GeoJSON at the SQL layer. */
const SELECT_COLUMNS = sql`
  authorization_id, ST_AsGeoJSON(area)::json AS area, max_altitude_ft, start_time, end_time,
  owner_id, pilot_id, status, rescinded_at, created_at, updated_at
`;

/** Maps a raw authorization row to its API record shape. */
function mapRow(row: AirspaceAuthorizationRow): AirspaceAuthorizationRecord {
  return {
    authorizationId: row.authorization_id,
    area: row.area,
    maxAltitudeFt: row.max_altitude_ft,
    startTime: row.start_time.toISOString(),
    endTime: row.end_time.toISOString(),
    ownerId: row.owner_id,
    pilotId: row.pilot_id,
    status: row.status,
    rescindedAt: row.rescinded_at ? row.rescinded_at.toISOString() : null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

/**
 * Creates a new airspace authorization. Validates `ownerId` (and `pilotId`, if given) against
 * Drone Registrations Service before writing, throwing `OwnerNotFoundError`/`PilotNotFoundError`
 * if either isn't found (or `DroneRegistrationsServiceUnavailableError`, propagated from the
 * client, if that service itself is unreachable), and `AuthorizationAlreadyExistsError` if the
 * id is taken.
 */
export async function insertAirspaceAuthorization(
  input: CreateAirspaceAuthorizationInput,
): Promise<AirspaceAuthorizationRecord> {
  if (!(await ownerExists(input.ownerId))) throw new OwnerNotFoundError(input.ownerId);
  if (input.pilotId != null && !(await pilotExistsUnderOwner(input.ownerId, input.pilotId))) {
    throw new PilotNotFoundError(input.pilotId);
  }

  try {
    const [row] = await sql<AirspaceAuthorizationRow[]>`
      INSERT INTO flight_authorizations.airspace_authorizations
        (authorization_id, area, max_altitude_ft, start_time, end_time, owner_id, pilot_id)
      VALUES (
        ${input.authorizationId}, ${geomFromGeoJson(input.area)}, ${input.maxAltitudeFt},
        ${input.startTime}::timestamptz, ${input.endTime}::timestamptz, ${input.ownerId}, ${input.pilotId ?? null}
      )
      RETURNING ${SELECT_COLUMNS}
    `;
    return mapRow(row!);
  } catch (err) {
    if (err instanceof SQL.PostgresError && err.errno === '23505') {
      throw new AuthorizationAlreadyExistsError(input.authorizationId);
    }
    throw err;
  }
}

/** Lists authorizations, optionally filtered by `ownerId`/`pilotId`/`activeAt`/`status`, oldest first. */
export async function listAirspaceAuthorizations(
  filter: ListAirspaceAuthorizationsFilter,
): Promise<AirspaceAuthorizationRecord[]> {
  const rows = await sql<AirspaceAuthorizationRow[]>`
    SELECT ${SELECT_COLUMNS}
    FROM flight_authorizations.airspace_authorizations
    WHERE (${filter.ownerId ?? null}::text IS NULL OR owner_id = ${filter.ownerId ?? null}::text)
      AND (${filter.pilotId ?? null}::text IS NULL OR pilot_id = ${filter.pilotId ?? null}::text)
      AND (${filter.status ?? null}::text IS NULL OR status = ${filter.status ?? null}::text)
      AND (
        ${filter.activeAt ?? null}::timestamptz IS NULL
        OR (start_time <= ${filter.activeAt ?? null}::timestamptz AND end_time >= ${filter.activeAt ?? null}::timestamptz)
      )
    ORDER BY created_at
  `;
  return rows.map(mapRow);
}

/** Fetches an authorization by id, or null if it doesn't exist. */
export async function getAirspaceAuthorizationById(authorizationId: string): Promise<AirspaceAuthorizationRecord | null> {
  const [row] = await sql<AirspaceAuthorizationRow[]>`
    SELECT ${SELECT_COLUMNS}
    FROM flight_authorizations.airspace_authorizations
    WHERE authorization_id = ${authorizationId}
  `;
  return row ? mapRow(row) : null;
}

/**
 * Applies a partial update to an authorization, or null if it doesn't exist. Throws
 * `RescindedIsTerminalError` if a `status` change is attempted on an already-`'rescinded'` row,
 * or `PilotNotFoundError` if a new `pilotId` doesn't exist under the authorization's (immutable)
 * owner. A transition to `'rescinded'` stamps `rescindedAt` server-side.
 */
export async function updateAirspaceAuthorization(
  authorizationId: string,
  patch: AirspaceAuthorizationPatch,
): Promise<AirspaceAuthorizationRecord | null> {
  const existing = await getAirspaceAuthorizationById(authorizationId);
  if (!existing) return null;

  if (patch.status !== undefined && existing.status === 'rescinded') {
    throw new RescindedIsTerminalError(authorizationId);
  }
  if (patch.pilotId != null && !(await pilotExistsUnderOwner(existing.ownerId, patch.pilotId))) {
    throw new PilotNotFoundError(patch.pilotId);
  }

  // 'pilotId' in patch distinguishes "omitted, leave pilot_id alone" from "explicitly null,
  // clear pilot_id back to unset" — both collapse to the same `?? null` value, so a plain
  // COALESCE (as used for the other fields below) can't tell them apart.
  const pilotIdProvided = 'pilotId' in patch;
  const rescinding = patch.status === 'rescinded';

  const [row] = await sql<AirspaceAuthorizationRow[]>`
    UPDATE flight_authorizations.airspace_authorizations
    SET
      max_altitude_ft = COALESCE(${patch.maxAltitudeFt ?? null}, max_altitude_ft),
      start_time = COALESCE(${patch.startTime ?? null}::timestamptz, start_time),
      end_time = COALESCE(${patch.endTime ?? null}::timestamptz, end_time),
      pilot_id = CASE WHEN ${pilotIdProvided} THEN ${patch.pilotId ?? null} ELSE pilot_id END,
      status = COALESCE(${patch.status ?? null}, status),
      rescinded_at = CASE WHEN ${rescinding} THEN now() ELSE rescinded_at END,
      updated_at = now()
    WHERE authorization_id = ${authorizationId}
    RETURNING ${SELECT_COLUMNS}
  `;
  return row ? mapRow(row) : null;
}

/** Authorization(s), of any status unless `status` narrows it, whose `area` contains the point and whose `[startTime, endTime]` covers `at`, optionally also requiring `maxAltitudeFt >= altitudeFt`. */
export async function listCoveringAuthorizations(
  lat: number,
  lon: number,
  at: string,
  altitudeFt?: number,
  status?: AirspaceAuthorizationStatus,
): Promise<AirspaceAuthorizationRecord[]> {
  const rows = await sql<AirspaceAuthorizationRow[]>`
    SELECT ${SELECT_COLUMNS}
    FROM flight_authorizations.airspace_authorizations
    WHERE ${containsPoint(lat, lon)}
      AND start_time <= ${at}::timestamptz AND end_time >= ${at}::timestamptz
      AND (${altitudeFt ?? null}::double precision IS NULL OR max_altitude_ft >= ${altitudeFt ?? null}::double precision)
      AND (${status ?? null}::text IS NULL OR status = ${status ?? null}::text)
    ORDER BY created_at
  `;
  return rows.map(mapRow);
}

/** Authorization(s) whose `area` intersects the given lat/lon bounding box, optionally filtered by `altitudeFt`/`at`/`status`. */
export async function listIntersectingAuthorizations(
  minLat: number,
  minLon: number,
  maxLat: number,
  maxLon: number,
  altitudeFt?: number,
  at?: string,
  status?: AirspaceAuthorizationStatus,
): Promise<AirspaceAuthorizationRecord[]> {
  const rows = await sql<AirspaceAuthorizationRow[]>`
    SELECT ${SELECT_COLUMNS}
    FROM flight_authorizations.airspace_authorizations
    WHERE ${intersectsEnvelope(sql`area`, minLat, minLon, maxLat, maxLon)}
      AND (${altitudeFt ?? null}::double precision IS NULL OR max_altitude_ft >= ${altitudeFt ?? null}::double precision)
      AND (
        ${at ?? null}::timestamptz IS NULL
        OR (start_time <= ${at ?? null}::timestamptz AND end_time >= ${at ?? null}::timestamptz)
      )
      AND (${status ?? null}::text IS NULL OR status = ${status ?? null}::text)
    ORDER BY created_at
  `;
  return rows.map(mapRow);
}
