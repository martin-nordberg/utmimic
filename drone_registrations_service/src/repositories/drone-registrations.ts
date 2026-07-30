import { SQL } from 'bun';
import { sql } from '../db';

/** A persisted drone registration, as returned to API clients. */
export interface DroneRegistrationRecord {
  registrationId: string;
  serialNumber: string;
  make: string;
  modelNumber: string;
  ownerId: string;
  startDate: string;
  endDate: string;
  createdAt: string;
  updatedAt: string;
}

/** Fields required to create a new drone registration. */
export interface CreateDroneRegistrationInput {
  registrationId: string;
  serialNumber: string;
  make: string;
  modelNumber: string;
  ownerId: string;
  startDate: string;
  endDate: string;
}

/** Fields to partially update on an existing registration; `ownerId`/`serialNumber` are immutable. */
export interface DroneRegistrationPatch {
  make?: string;
  modelNumber?: string;
  startDate?: string;
  endDate?: string;
}

/** Optional filters for listing drone registrations, AND'd together. */
export interface DroneRegistrationFilter {
  serialNumber?: string;
  ownerId?: string;
  asOf?: string;
}

/** Thrown when creating a registration whose id already exists. */
export class DroneRegistrationAlreadyExistsError extends Error {
  constructor(registrationId: string) {
    super(`Drone registration ${registrationId} already exists`);
  }
}

/** Thrown when a registration's date range would overlap another registration for the same serial number. */
export class OverlappingRegistrationError extends Error {
  constructor(serialNumber: string) {
    super(`Registration period overlaps an existing registration for serial number ${serialNumber}`);
  }
}

/** Raw `drone_registrations` table row shape, before mapping to `DroneRegistrationRecord`. */
interface DroneRegistrationRow {
  registration_id: string;
  serial_number: string;
  make: string;
  model_number: string;
  owner_id: string;
  // Bun.SQL returns Postgres `date` columns as JS Date objects, not 'YYYY-MM-DD' strings.
  start_date: Date;
  end_date: Date;
  created_at: Date;
  updated_at: Date;
}

/** Formats a `date`-column value as a plain `YYYY-MM-DD` string. */
function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Maps a raw drone registration row to its API record shape. */
function mapRow(row: DroneRegistrationRow): DroneRegistrationRecord {
  return {
    registrationId: row.registration_id,
    serialNumber: row.serial_number,
    make: row.make,
    modelNumber: row.model_number,
    ownerId: row.owner_id,
    startDate: formatDate(row.start_date),
    endDate: formatDate(row.end_date),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

/**
 * Finds an existing registration for `serialNumber` whose date range overlaps
 * `[startDate, endDate]`, excluding `excludeRegistrationId` (used by `PATCH` to exclude the row
 * being updated from its own overlap check). Returns the overlapping registration's id, or null.
 */
async function findOverlappingRegistration(
  serialNumber: string,
  startDate: string,
  endDate: string,
  excludeRegistrationId?: string,
): Promise<string | null> {
  const [row] = await sql<{ registration_id: string }[]>`
    SELECT registration_id FROM drone_registrations.drone_registrations
    WHERE serial_number = ${serialNumber}
      AND start_date <= ${endDate}::date
      AND end_date >= ${startDate}::date
      AND registration_id != COALESCE(${excludeRegistrationId ?? null}, '')
  `;
  return row ? row.registration_id : null;
}

/**
 * Creates a new drone registration. Throws `OverlappingRegistrationError` if the date range
 * overlaps an existing registration for the same serial number, or
 * `DroneRegistrationAlreadyExistsError` if the id is taken.
 */
export async function insertDroneRegistration(input: CreateDroneRegistrationInput): Promise<DroneRegistrationRecord> {
  if (await findOverlappingRegistration(input.serialNumber, input.startDate, input.endDate)) {
    throw new OverlappingRegistrationError(input.serialNumber);
  }

  try {
    const [row] = await sql<DroneRegistrationRow[]>`
      INSERT INTO drone_registrations.drone_registrations (
        registration_id, serial_number, make, model_number, owner_id, start_date, end_date
      ) VALUES (
        ${input.registrationId}, ${input.serialNumber}, ${input.make}, ${input.modelNumber},
        ${input.ownerId}, ${input.startDate}::date, ${input.endDate}::date
      )
      RETURNING *
    `;
    return mapRow(row!);
  } catch (err) {
    if (err instanceof SQL.PostgresError && err.errno === '23505') {
      throw new DroneRegistrationAlreadyExistsError(input.registrationId);
    }
    throw err;
  }
}

/** Lists drone registrations, optionally filtered by `serialNumber`/`ownerId`/active-as-of `asOf`, oldest first. */
export async function listDroneRegistrations(filter: DroneRegistrationFilter): Promise<DroneRegistrationRecord[]> {
  const rows = await sql<DroneRegistrationRow[]>`
    SELECT * FROM drone_registrations.drone_registrations
    WHERE (${filter.serialNumber ?? null}::text IS NULL OR serial_number = ${filter.serialNumber ?? null}::text)
      AND (${filter.ownerId ?? null}::text IS NULL OR owner_id = ${filter.ownerId ?? null}::text)
      AND (
        ${filter.asOf ?? null}::date IS NULL
        OR (start_date <= ${filter.asOf ?? null}::date AND end_date >= ${filter.asOf ?? null}::date)
      )
    ORDER BY created_at
  `;
  return rows.map(mapRow);
}

/** Fetches a drone registration by id, or null if it doesn't exist. */
export async function getDroneRegistrationById(registrationId: string): Promise<DroneRegistrationRecord | null> {
  const [row] = await sql<DroneRegistrationRow[]>`
    SELECT * FROM drone_registrations.drone_registrations WHERE registration_id = ${registrationId}
  `;
  return row ? mapRow(row) : null;
}

/**
 * Applies a partial update to a drone registration, or null if it doesn't exist. Re-runs the
 * overlap check (excluding this registration itself) whenever `startDate`/`endDate` change.
 */
export async function updateDroneRegistration(
  registrationId: string,
  patch: DroneRegistrationPatch,
): Promise<DroneRegistrationRecord | null> {
  if (patch.startDate !== undefined || patch.endDate !== undefined) {
    const existing = await getDroneRegistrationById(registrationId);
    if (!existing) return null;

    const startDate = patch.startDate ?? existing.startDate;
    const endDate = patch.endDate ?? existing.endDate;
    if (await findOverlappingRegistration(existing.serialNumber, startDate, endDate, registrationId)) {
      throw new OverlappingRegistrationError(existing.serialNumber);
    }
  }

  const [row] = await sql<DroneRegistrationRow[]>`
    UPDATE drone_registrations.drone_registrations
    SET
      make = COALESCE(${patch.make ?? null}, make),
      model_number = COALESCE(${patch.modelNumber ?? null}, model_number),
      start_date = COALESCE(${patch.startDate ?? null}::date, start_date),
      end_date = COALESCE(${patch.endDate ?? null}::date, end_date),
      updated_at = now()
    WHERE registration_id = ${registrationId}
    RETURNING *
  `;
  return row ? mapRow(row) : null;
}

/**
 * The registration active for a serial number as of `asOf` (defaulting to today), or null if
 * none. In the pathological case the application-level overlap check somehow missed and more
 * than one registration matches, the most recently started one wins.
 */
export async function getActiveRegistrationBySerial(
  serialNumber: string,
  asOf?: string,
): Promise<DroneRegistrationRecord | null> {
  const effectiveAsOf = asOf ?? new Date().toISOString().slice(0, 10);
  const [row] = await sql<DroneRegistrationRow[]>`
    SELECT * FROM drone_registrations.drone_registrations
    WHERE serial_number = ${serialNumber}
      AND start_date <= ${effectiveAsOf}::date
      AND end_date >= ${effectiveAsOf}::date
    ORDER BY start_date DESC
    LIMIT 1
  `;
  return row ? mapRow(row) : null;
}
