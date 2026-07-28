import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { sql } from '../src/db';
import { logger } from '../src/logger';

const MIGRATIONS_DIR = import.meta.dir;

interface Migration {
  up(sql: Bun.SQL): Promise<unknown>;
}

export async function runMigrations(): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS sensor_flight_log.schema_migrations (
      filename text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `;

  const applied = new Set(
    (await sql<{ filename: string }[]>`SELECT filename FROM sensor_flight_log.schema_migrations`).map(
      (row) => row.filename,
    ),
  );

  const pending = (await readdir(MIGRATIONS_DIR))
    .filter((filename) => filename.endsWith('.ts') && filename !== 'run.ts' && !applied.has(filename))
    .sort();

  for (const filename of pending) {
    const migration: Migration = await import(path.join(MIGRATIONS_DIR, filename));

    await sql.begin(async (tx) => {
      await migration.up(tx);
      await tx`INSERT INTO sensor_flight_log.schema_migrations (filename) VALUES (${filename})`;
    });

    logger.info(`Applied migration ${filename}`);
  }
}

if (import.meta.main) {
  await runMigrations();
  await sql.close();
}
