import { SQL } from 'bun';
import { sql } from '../db';

export interface SensorProfileRecord {
  sensorId: string;
  profile: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export class ProfileSensorNotFoundError extends Error {
  constructor(sensorId: string) {
    super(`Sensor ${sensorId} not found`);
  }
}

interface SensorProfileRow {
  sensor_id: string;
  profile: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
}

function mapRow(row: SensorProfileRow): SensorProfileRecord {
  return {
    sensorId: row.sensor_id,
    profile: row.profile,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export async function upsertProfile(
  sensorId: string,
  profile: Record<string, unknown>,
): Promise<SensorProfileRecord> {
  try {
    const [row] = await sql<SensorProfileRow[]>`
      INSERT INTO sensor_flight_log.sensor_profiles (sensor_id, profile)
      VALUES (${sensorId}, ${profile})
      ON CONFLICT (sensor_id) DO UPDATE SET profile = EXCLUDED.profile, updated_at = now()
      RETURNING *
    `;
    return mapRow(row!);
  } catch (err) {
    if (err instanceof SQL.PostgresError && err.errno === '23503') {
      throw new ProfileSensorNotFoundError(sensorId);
    }
    throw err;
  }
}

export async function getProfile(sensorId: string): Promise<SensorProfileRecord | null> {
  const [row] = await sql<SensorProfileRow[]>`
    SELECT * FROM sensor_flight_log.sensor_profiles WHERE sensor_id = ${sensorId}
  `;
  return row ? mapRow(row) : null;
}

export async function deleteProfile(sensorId: string): Promise<void> {
  await sql`DELETE FROM sensor_flight_log.sensor_profiles WHERE sensor_id = ${sensorId}`;
}
