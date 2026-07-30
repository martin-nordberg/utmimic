import { runMigrations } from '../../migrations/run';
import { sql } from '../db';

/** Drops and recreates the schema, then reapplies all migrations — for test isolation. */
export async function resetSchema(): Promise<void> {
  await sql`DROP SCHEMA IF EXISTS weather CASCADE`;
  await sql`CREATE SCHEMA weather`;
  await runMigrations();
}
