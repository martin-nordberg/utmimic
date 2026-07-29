import { SQL } from 'bun';
import { sql } from '../db';

/** A sensor's stored simulation profile. */
export interface SensorProfileRecord {
  sensorId: string;
  profile: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

/** Thrown when setting a profile for a sensor that doesn't exist. */
export class ProfileSensorNotFoundError extends Error {
  constructor(sensorId: string) {
    super(`Sensor ${sensorId} not found`);
  }
}

/** Raw `sensor_profiles` table row shape, before mapping to `SensorProfileRecord`. */
interface SensorProfileRow {
  sensor_id: string;
  profile: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
}

/** Maps a raw profile row to its API record shape. */
function mapRow(row: SensorProfileRow): SensorProfileRecord {
  return {
    sensorId: row.sensor_id,
    profile: row.profile,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

/** Creates or replaces a sensor's profile; throws `ProfileSensorNotFoundError` if the sensor doesn't exist. */
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

/** Fetches a sensor's profile, or null if none is set. */
export async function getProfile(sensorId: string): Promise<SensorProfileRecord | null> {
  const [row] = await sql<SensorProfileRow[]>`
    SELECT * FROM sensor_flight_log.sensor_profiles WHERE sensor_id = ${sensorId}
  `;
  return row ? mapRow(row) : null;
}

/** Deletes a sensor's profile, if one exists. */
export async function deleteProfile(sensorId: string): Promise<void> {
  await sql`DELETE FROM sensor_flight_log.sensor_profiles WHERE sensor_id = ${sensorId}`;
}
