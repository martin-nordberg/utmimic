import { runMigrations } from '../../migrations/run';
import { sql } from '../db';

/** Drops and recreates the schema, then reapplies all migrations — for test isolation. */
export async function resetSchema(): Promise<void> {
  await sql`DROP SCHEMA IF EXISTS live_flight_log CASCADE`;
  await sql`CREATE SCHEMA live_flight_log`;
  await runMigrations();
}
