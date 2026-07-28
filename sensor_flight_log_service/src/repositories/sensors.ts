import { SQL } from 'bun';
import { sql } from '../db';

export type SensorStatus = 'online' | 'offline';

export interface SensorRecord {
  sensorId: string;
  name: string;
  notes: string | null;
  latitude: number;
  longitude: number;
  sensingRadiusMeters: number;
  status: SensorStatus;
  createdAt: string;
  updatedAt: string;
}

export interface CreateSensorInput {
  sensorId: string;
  name: string;
  notes?: string;
  latitude: number;
  longitude: number;
  sensingRadiusMeters: number;
  status: SensorStatus;
}

export interface SensorPatch {
  name?: string;
  notes?: string;
  latitude?: number;
  longitude?: number;
  sensingRadiusMeters?: number;
  status?: SensorStatus;
}

export class SensorAlreadyExistsError extends Error {
  constructor(sensorId: string) {
    super(`Sensor ${sensorId} already exists`);
  }
}

interface SensorRow {
  sensor_id: string;
  name: string;
  notes: string | null;
  latitude: number;
  longitude: number;
  sensing_radius_meters: number;
  status: SensorStatus;
  created_at: Date;
  updated_at: Date;
}

function mapRow(row: SensorRow): SensorRecord {
  return {
    sensorId: row.sensor_id,
    name: row.name,
    notes: row.notes,
    latitude: row.latitude,
    longitude: row.longitude,
    sensingRadiusMeters: row.sensing_radius_meters,
    status: row.status,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export async function insertSensor(input: CreateSensorInput): Promise<SensorRecord> {
  try {
    const [row] = await sql<SensorRow[]>`
      INSERT INTO sensor_flight_log.sensors (
        sensor_id, name, notes, latitude, longitude, sensing_radius_meters, status
      ) VALUES (
        ${input.sensorId}, ${input.name}, ${input.notes ?? null}, ${input.latitude},
        ${input.longitude}, ${input.sensingRadiusMeters}, ${input.status}
      )
      RETURNING *
    `;
    return mapRow(row!);
  } catch (err) {
    if (err instanceof SQL.PostgresError && err.errno === '23505') {
      throw new SensorAlreadyExistsError(input.sensorId);
    }
    throw err;
  }
}

export async function listSensors(): Promise<SensorRecord[]> {
  const rows = await sql<SensorRow[]>`
    SELECT * FROM sensor_flight_log.sensors ORDER BY created_at
  `;
  return rows.map(mapRow);
}

export async function getSensorById(sensorId: string): Promise<SensorRecord | null> {
  const [row] = await sql<SensorRow[]>`
    SELECT * FROM sensor_flight_log.sensors WHERE sensor_id = ${sensorId}
  `;
  return row ? mapRow(row) : null;
}

export async function updateSensor(sensorId: string, patch: SensorPatch): Promise<SensorRecord | null> {
  const [row] = await sql<SensorRow[]>`
    UPDATE sensor_flight_log.sensors
    SET
      name = COALESCE(${patch.name ?? null}, name),
      notes = COALESCE(${patch.notes ?? null}, notes),
      latitude = COALESCE(${patch.latitude ?? null}, latitude),
      longitude = COALESCE(${patch.longitude ?? null}, longitude),
      sensing_radius_meters = COALESCE(${patch.sensingRadiusMeters ?? null}, sensing_radius_meters),
      status = COALESCE(${patch.status ?? null}, status),
      updated_at = now()
    WHERE sensor_id = ${sensorId}
    RETURNING *
  `;
  return row ? mapRow(row) : null;
}
