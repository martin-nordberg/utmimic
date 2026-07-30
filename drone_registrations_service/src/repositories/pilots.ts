import { SQL } from 'bun';
import { sql } from '../db';
import { getOwnerById } from './owners';

/** A persisted pilot, as returned to API clients. */
export interface PilotRecord {
  pilotId: string;
  organizationOwnerId: string;
  name: string;
  phoneNumber: string;
  licenseNumber: string;
  createdAt: string;
  updatedAt: string;
}

/** Fields required to add a new pilot under an organization owner. */
export interface CreatePilotInput {
  pilotId: string;
  name: string;
  phoneNumber: string;
  licenseNumber: string;
}

/** Fields to partially update on an existing pilot; `organizationOwnerId` is immutable. */
export interface PilotPatch {
  name?: string;
  phoneNumber?: string;
  licenseNumber?: string;
}

/** Thrown when adding a pilot under an owner that doesn't exist. */
export class PilotOwnerNotFoundError extends Error {
  constructor(ownerId: string) {
    super(`Owner ${ownerId} not found`);
  }
}

/** Thrown when adding a pilot under an owner that exists but isn't `organization`-typed. */
export class PilotOwnerNotOrganizationError extends Error {
  constructor(ownerId: string) {
    super(`Owner ${ownerId} is not an organization`);
  }
}

/** Thrown when adding a pilot whose id already exists. */
export class PilotAlreadyExistsError extends Error {
  constructor(pilotId: string) {
    super(`Pilot ${pilotId} already exists`);
  }
}

/** Raw `pilots` table row shape, before mapping to `PilotRecord`. */
interface PilotRow {
  pilot_id: string;
  organization_owner_id: string;
  name: string;
  phone_number: string;
  license_number: string;
  created_at: Date;
  updated_at: Date;
}

/** Maps a raw pilot row to its API record shape. */
function mapRow(row: PilotRow): PilotRecord {
  return {
    pilotId: row.pilot_id,
    organizationOwnerId: row.organization_owner_id,
    name: row.name,
    phoneNumber: row.phone_number,
    licenseNumber: row.license_number,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

/**
 * Adds a new pilot under an organization owner. Throws `PilotOwnerNotFoundError` if the owner
 * doesn't exist, `PilotOwnerNotOrganizationError` if it exists but isn't `organization`-typed
 * (a plain application-level lookup — the table's CHECK constraint can't reference another
 * table), or `PilotAlreadyExistsError` if the id is taken.
 */
export async function insertPilot(ownerId: string, input: CreatePilotInput): Promise<PilotRecord> {
  const owner = await getOwnerById(ownerId);
  if (!owner) throw new PilotOwnerNotFoundError(ownerId);
  if (owner.ownerType !== 'organization') throw new PilotOwnerNotOrganizationError(ownerId);

  try {
    const [row] = await sql<PilotRow[]>`
      INSERT INTO drone_registrations.pilots (pilot_id, organization_owner_id, name, phone_number, license_number)
      VALUES (${input.pilotId}, ${ownerId}, ${input.name}, ${input.phoneNumber}, ${input.licenseNumber})
      RETURNING *
    `;
    return mapRow(row!);
  } catch (err) {
    if (err instanceof SQL.PostgresError && err.errno === '23505') {
      throw new PilotAlreadyExistsError(input.pilotId);
    }
    throw err;
  }
}

/** Lists all pilots under an organization owner, oldest first. */
export async function listPilotsForOwner(ownerId: string): Promise<PilotRecord[]> {
  const rows = await sql<PilotRow[]>`
    SELECT * FROM drone_registrations.pilots WHERE organization_owner_id = ${ownerId} ORDER BY created_at
  `;
  return rows.map(mapRow);
}

/** Fetches a pilot by id, scoped to its owning organization, or null if no match. */
export async function getPilotById(ownerId: string, pilotId: string): Promise<PilotRecord | null> {
  const [row] = await sql<PilotRow[]>`
    SELECT * FROM drone_registrations.pilots
    WHERE pilot_id = ${pilotId} AND organization_owner_id = ${ownerId}
  `;
  return row ? mapRow(row) : null;
}

/** Applies a partial update to a pilot, scoped to its owning organization, or null if no match. */
export async function updatePilot(ownerId: string, pilotId: string, patch: PilotPatch): Promise<PilotRecord | null> {
  const [row] = await sql<PilotRow[]>`
    UPDATE drone_registrations.pilots
    SET
      name = COALESCE(${patch.name ?? null}, name),
      phone_number = COALESCE(${patch.phoneNumber ?? null}, phone_number),
      license_number = COALESCE(${patch.licenseNumber ?? null}, license_number),
      updated_at = now()
    WHERE pilot_id = ${pilotId} AND organization_owner_id = ${ownerId}
    RETURNING *
  `;
  return row ? mapRow(row) : null;
}

/** Deletes a pilot, scoped to its owning organization, if one matches. */
export async function deletePilot(ownerId: string, pilotId: string): Promise<void> {
  await sql`
    DELETE FROM drone_registrations.pilots
    WHERE pilot_id = ${pilotId} AND organization_owner_id = ${ownerId}
  `;
}
