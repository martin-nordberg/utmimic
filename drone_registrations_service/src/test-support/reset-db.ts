import { runMigrations } from '../../migrations/run';
import { sql } from '../db';

/** Drops and recreates the schema, then reapplies all migrations — for test isolation. */
export async function resetSchema(): Promise<void> {
  await sql`DROP SCHEMA IF EXISTS drone_registrations CASCADE`;
  await sql`CREATE SCHEMA drone_registrations`;
  await runMigrations();
}
