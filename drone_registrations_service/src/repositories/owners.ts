import { SQL } from 'bun';
import { sql } from '../db';

/** Whether an owner is an individual person or an organization. */
export type OwnerType = 'individual' | 'organization';

/** A persisted owner, as returned to API clients. */
export interface OwnerRecord {
  ownerId: string;
  ownerType: OwnerType;
  companyName?: string;
  firstName: string;
  lastName: string;
  phoneNumber: string;
  addressLine1: string;
  addressLine2?: string;
  addressCity: string;
  addressState: string;
  addressZip: string;
  email: string;
  createdAt: string;
  updatedAt: string;
}

/** Fields required to register a new owner. */
export interface CreateOwnerInput {
  ownerId: string;
  ownerType: OwnerType;
  companyName?: string;
  firstName: string;
  lastName: string;
  phoneNumber: string;
  addressLine1: string;
  addressLine2?: string;
  addressCity: string;
  addressState: string;
  addressZip: string;
  email: string;
}

/** Fields to partially update on an existing owner; `ownerType`/`companyName` are immutable. */
export interface OwnerPatch {
  firstName?: string;
  lastName?: string;
  phoneNumber?: string;
  addressLine1?: string;
  addressLine2?: string;
  addressCity?: string;
  addressState?: string;
  addressZip?: string;
  email?: string;
}

/** Thrown when registering an owner whose id already exists. */
export class OwnerAlreadyExistsError extends Error {
  constructor(ownerId: string) {
    super(`Owner ${ownerId} already exists`);
  }
}

/** Raw `owners` table row shape, before mapping to `OwnerRecord`. */
interface OwnerRow {
  owner_id: string;
  owner_type: OwnerType;
  company_name: string | null;
  first_name: string;
  last_name: string;
  phone_number: string;
  address_line1: string;
  address_line2: string | null;
  address_city: string;
  address_state: string;
  address_zip: string;
  email: string;
  created_at: Date;
  updated_at: Date;
}

/** Maps a raw owner row to its API record shape. */
function mapRow(row: OwnerRow): OwnerRecord {
  return {
    ownerId: row.owner_id,
    ownerType: row.owner_type,
    companyName: row.company_name ?? undefined,
    firstName: row.first_name,
    lastName: row.last_name,
    phoneNumber: row.phone_number,
    addressLine1: row.address_line1,
    addressLine2: row.address_line2 ?? undefined,
    addressCity: row.address_city,
    addressState: row.address_state,
    addressZip: row.address_zip,
    email: row.email,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

/** Inserts a new owner, throwing `OwnerAlreadyExistsError` if the id is taken. */
export async function insertOwner(input: CreateOwnerInput): Promise<OwnerRecord> {
  try {
    const [row] = await sql<OwnerRow[]>`
      INSERT INTO drone_registrations.owners (
        owner_id, owner_type, company_name, first_name, last_name, phone_number,
        address_line1, address_line2, address_city, address_state, address_zip, email
      ) VALUES (
        ${input.ownerId}, ${input.ownerType}, ${input.companyName ?? null}, ${input.firstName}, ${input.lastName},
        ${input.phoneNumber}, ${input.addressLine1}, ${input.addressLine2 ?? null}, ${input.addressCity},
        ${input.addressState}, ${input.addressZip}, ${input.email}
      )
      RETURNING *
    `;
    return mapRow(row!);
  } catch (err) {
    if (err instanceof SQL.PostgresError && err.errno === '23505') {
      throw new OwnerAlreadyExistsError(input.ownerId);
    }
    throw err;
  }
}

/** Lists all owners, oldest first. */
export async function listOwners(): Promise<OwnerRecord[]> {
  const rows = await sql<OwnerRow[]>`
    SELECT * FROM drone_registrations.owners ORDER BY created_at
  `;
  return rows.map(mapRow);
}

/** Fetches an owner by id, or null if it doesn't exist. */
export async function getOwnerById(ownerId: string): Promise<OwnerRecord | null> {
  const [row] = await sql<OwnerRow[]>`
    SELECT * FROM drone_registrations.owners WHERE owner_id = ${ownerId}
  `;
  return row ? mapRow(row) : null;
}

/** Applies a partial update to an owner, or null if it doesn't exist. */
export async function updateOwner(ownerId: string, patch: OwnerPatch): Promise<OwnerRecord | null> {
  const [row] = await sql<OwnerRow[]>`
    UPDATE drone_registrations.owners
    SET
      first_name = COALESCE(${patch.firstName ?? null}, first_name),
      last_name = COALESCE(${patch.lastName ?? null}, last_name),
      phone_number = COALESCE(${patch.phoneNumber ?? null}, phone_number),
      address_line1 = COALESCE(${patch.addressLine1 ?? null}, address_line1),
      address_line2 = COALESCE(${patch.addressLine2 ?? null}, address_line2),
      address_city = COALESCE(${patch.addressCity ?? null}, address_city),
      address_state = COALESCE(${patch.addressState ?? null}, address_state),
      address_zip = COALESCE(${patch.addressZip ?? null}, address_zip),
      email = COALESCE(${patch.email ?? null}, email),
      updated_at = now()
    WHERE owner_id = ${ownerId}
    RETURNING *
  `;
  return row ? mapRow(row) : null;
}
