import { runMigrations } from '../../migrations/run';
import { sql } from '../db';

export async function resetSchema(): Promise<void> {
  await sql`DROP SCHEMA IF EXISTS sensor_flight_log CASCADE`;
  await sql`CREATE SCHEMA sensor_flight_log`;
  await runMigrations();
}
