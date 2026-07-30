import { SQL } from 'bun';
import { ownerExists, pilotExistsStandalone } from '../drone-registrations-client';
import { sql } from '../db';

/** The FAA Part 107 waiver categories this service models, matching the table's CHECK constraint. */
export type WaiverType =
  | 'operations_from_moving_vehicle'
  | 'night_operations'
  | 'beyond_visual_line_of_sight'
  | 'operations_over_people';

/** Waiver lifecycle status, matching the table's CHECK constraint. */
export type WaiverStatus = 'proposed' | 'approved' | 'rescinded';

/** A persisted waiver, as returned to API clients. */
export interface WaiverRecord {
  waiverId: string;
  waiverType: WaiverType;
  pilotId: string | null;
  ownerId: string | null;
  conditions: string;
  startTime: string;
  endTime: string;
  status: WaiverStatus;
  rescindedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Fields required to create a new waiver; exactly one of `pilotId`/`ownerId` must be set. */
export interface CreateWaiverInput {
  waiverId: string;
  waiverType: WaiverType;
  pilotId?: string | null;
  ownerId?: string | null;
  conditions: string;
  startTime: string;
  endTime: string;
}

/** Fields to partially update on an existing waiver; `waiverType`/`pilotId`/`ownerId` are immutable. */
export interface WaiverPatch {
  conditions?: string;
  startTime?: string;
  endTime?: string;
  status?: WaiverStatus;
}

/** Optional filters for listing waivers, AND'd together. */
export interface ListWaiversFilter {
  pilotId?: string;
  ownerId?: string;
  waiverType?: WaiverType;
  activeAt?: string;
  status?: WaiverStatus;
}

/** Thrown when creating a waiver whose id already exists. */
export class WaiverAlreadyExistsError extends Error {
  constructor(waiverId: string) {
    super(`Waiver ${waiverId} already exists`);
  }
}

/** Thrown when the given `ownerId` doesn't exist in Drone Registrations Service. */
export class OwnerNotFoundError extends Error {
  constructor(ownerId: string) {
    super(`Owner ${ownerId} not found`);
  }
}

/** Thrown when the given `pilotId` doesn't exist in Drone Registrations Service. */
export class PilotNotFoundError extends Error {
  constructor(pilotId: string) {
    super(`Pilot ${pilotId} not found`);
  }
}

/** Thrown when a `status` change is attempted on a waiver that's already `'rescinded'` — terminal, per the spec. */
export class RescindedIsTerminalError extends Error {
  constructor(waiverId: string) {
    super(`Waiver ${waiverId} is rescinded and cannot change status further`);
  }
}

/** Raw `waivers` table row shape, before mapping to `WaiverRecord`. */
interface WaiverRow {
  waiver_id: string;
  waiver_type: WaiverType;
  pilot_id: string | null;
  owner_id: string | null;
  conditions: string;
  start_time: Date;
  end_time: Date;
  status: WaiverStatus;
  rescinded_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

/** Columns selected by every query below. */
const SELECT_COLUMNS = sql`
  waiver_id, waiver_type, pilot_id, owner_id, conditions, start_time, end_time,
  status, rescinded_at, created_at, updated_at
`;

/** Maps a raw waiver row to its API record shape. */
function mapRow(row: WaiverRow): WaiverRecord {
  return {
    waiverId: row.waiver_id,
    waiverType: row.waiver_type,
    pilotId: row.pilot_id,
    ownerId: row.owner_id,
    conditions: row.conditions,
    startTime: row.start_time.toISOString(),
    endTime: row.end_time.toISOString(),
    status: row.status,
    rescindedAt: row.rescinded_at ? row.rescinded_at.toISOString() : null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

/**
 * Creates a new waiver. Validates whichever of `ownerId`/`pilotId` is set against Drone
 * Registrations Service before writing — `ownerId` via the plain owner lookup, `pilotId` via the
 * standalone pilot lookup (this waiver has no `ownerId` alongside it to scope a nested one).
 * Throws `OwnerNotFoundError`/`PilotNotFoundError` if not found, or `WaiverAlreadyExistsError` if
 * the id is taken.
 */
export async function insertWaiver(input: CreateWaiverInput): Promise<WaiverRecord> {
  if (input.ownerId != null && !(await ownerExists(input.ownerId))) throw new OwnerNotFoundError(input.ownerId);
  if (input.pilotId != null && !(await pilotExistsStandalone(input.pilotId))) throw new PilotNotFoundError(input.pilotId);

  try {
    const [row] = await sql<WaiverRow[]>`
      INSERT INTO flight_authorizations.waivers
        (waiver_id, waiver_type, pilot_id, owner_id, conditions, start_time, end_time)
      VALUES (
        ${input.waiverId}, ${input.waiverType}, ${input.pilotId ?? null}, ${input.ownerId ?? null},
        ${input.conditions}, ${input.startTime}::timestamptz, ${input.endTime}::timestamptz
      )
      RETURNING ${SELECT_COLUMNS}
    `;
    return mapRow(row!);
  } catch (err) {
    if (err instanceof SQL.PostgresError && err.errno === '23505') {
      throw new WaiverAlreadyExistsError(input.waiverId);
    }
    throw err;
  }
}

/** Lists waivers, optionally filtered by `pilotId`/`ownerId`/`waiverType`/`activeAt`/`status`, oldest first. */
export async function listWaivers(filter: ListWaiversFilter): Promise<WaiverRecord[]> {
  const rows = await sql<WaiverRow[]>`
    SELECT ${SELECT_COLUMNS}
    FROM flight_authorizations.waivers
    WHERE (${filter.pilotId ?? null}::text IS NULL OR pilot_id = ${filter.pilotId ?? null}::text)
      AND (${filter.ownerId ?? null}::text IS NULL OR owner_id = ${filter.ownerId ?? null}::text)
      AND (${filter.waiverType ?? null}::text IS NULL OR waiver_type = ${filter.waiverType ?? null}::text)
      AND (${filter.status ?? null}::text IS NULL OR status = ${filter.status ?? null}::text)
      AND (
        ${filter.activeAt ?? null}::timestamptz IS NULL
        OR (start_time <= ${filter.activeAt ?? null}::timestamptz AND end_time >= ${filter.activeAt ?? null}::timestamptz)
      )
    ORDER BY created_at
  `;
  return rows.map(mapRow);
}

/** Fetches a waiver by id, or null if it doesn't exist. */
export async function getWaiverById(waiverId: string): Promise<WaiverRecord | null> {
  const [row] = await sql<WaiverRow[]>`
    SELECT ${SELECT_COLUMNS} FROM flight_authorizations.waivers WHERE waiver_id = ${waiverId}
  `;
  return row ? mapRow(row) : null;
}

/**
 * Applies a partial update to a waiver, or null if it doesn't exist. Throws
 * `RescindedIsTerminalError` if a `status` change is attempted on an already-`'rescinded'` row. A
 * transition to `'rescinded'` stamps `rescindedAt` server-side.
 */
export async function updateWaiver(waiverId: string, patch: WaiverPatch): Promise<WaiverRecord | null> {
  const existing = await getWaiverById(waiverId);
  if (!existing) return null;

  const rescinding = patch.status === 'rescinded';
  const changingStatus = patch.status !== undefined;

  // The "rescinded is terminal" guard lives in the UPDATE's WHERE clause, not as a separate
  // pre-check against `existing.status` above — that would read-then-write with a gap in
  // between, letting two concurrent PATCHes both pass the check before either commits. Gating
  // the row match itself makes Postgres's row lock resolve the race: whichever UPDATE commits
  // first flips the status, and the other's WHERE no longer matches.
  const [row] = await sql<WaiverRow[]>`
    UPDATE flight_authorizations.waivers
    SET
      conditions = COALESCE(${patch.conditions ?? null}, conditions),
      start_time = COALESCE(${patch.startTime ?? null}::timestamptz, start_time),
      end_time = COALESCE(${patch.endTime ?? null}::timestamptz, end_time),
      status = COALESCE(${patch.status ?? null}, status),
      rescinded_at = CASE WHEN ${rescinding} THEN now() ELSE rescinded_at END,
      updated_at = now()
    WHERE waiver_id = ${waiverId}
      AND (NOT ${changingStatus} OR status <> 'rescinded')
    RETURNING ${SELECT_COLUMNS}
  `;
  if (row) return mapRow(row);
  // No row matched despite `existing` having just been found: the only way that happens is the
  // status guard above blocking a status change on an already- (or concurrently-) rescinded row.
  throw new RescindedIsTerminalError(waiverId);
}
