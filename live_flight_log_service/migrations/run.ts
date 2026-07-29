import { sql } from '../src/db';
import { logger } from '../src/logger';
import * as m0001CreatePositionReports from './0001_create_position_reports';

/** A single schema migration module, applying `up` inside a transaction. */
interface Migration {
  up(sql: Bun.SQL): Promise<unknown>;
}

/** Migrations to apply, in order. */
const migrations: { filename: string; module: Migration }[] = [
  { filename: '0001_create_position_reports.ts', module: m0001CreatePositionReports },
];

/** Applies any not-yet-applied migrations, recording each in `schema_migrations`. */
export async function runMigrations(): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS live_flight_log.schema_migrations (
      filename text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `;

  const applied = new Set(
    (await sql<{ filename: string }[]>`SELECT filename FROM live_flight_log.schema_migrations`).map(
      (row) => row.filename,
    ),
  );

  // migrations is registered by hand above, rather than discovered via readdir/dynamic
  // import: a runtime filesystem scan can't be resolved by bun build --compile, since the
  // compiled binary has no migrations/ directory on disk and a computed import() path can't
  // be statically bundled. Add new migrations to the list above, in order, alongside the file.
  for (const { filename, module } of migrations) {
    if (applied.has(filename)) continue;

    await sql.begin(async (tx) => {
      await module.up(tx);
      await tx`INSERT INTO live_flight_log.schema_migrations (filename) VALUES (${filename})`;
    });

    logger.info(`Applied migration ${filename}`);
  }
}

if (import.meta.main) {
  await runMigrations();
  await sql.close();
}
