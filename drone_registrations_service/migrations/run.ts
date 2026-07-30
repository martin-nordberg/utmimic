import { sql } from '../src/db';
import { logger } from '../src/logger';
import * as m0001CreateOwners from './0001_create_owners';
import * as m0002CreatePilots from './0002_create_pilots';
import * as m0003CreateDroneRegistrations from './0003_create_drone_registrations';

/** A single schema migration module, applying `up` inside a transaction. */
interface Migration {
  up(sql: Bun.SQL): Promise<unknown>;
}

/** Migrations to apply, in order. */
const migrations: { filename: string; module: Migration }[] = [
  { filename: '0001_create_owners.ts', module: m0001CreateOwners },
  { filename: '0002_create_pilots.ts', module: m0002CreatePilots },
  { filename: '0003_create_drone_registrations.ts', module: m0003CreateDroneRegistrations },
];

/** Applies any not-yet-applied migrations, recording each in `schema_migrations`. */
export async function runMigrations(): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS drone_registrations.schema_migrations (
      filename text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `;

  const applied = new Set(
    (await sql<{ filename: string }[]>`SELECT filename FROM drone_registrations.schema_migrations`).map(
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
      await tx`INSERT INTO drone_registrations.schema_migrations (filename) VALUES (${filename})`;
    });

    logger.info(`Applied migration ${filename}`);
  }
}

if (import.meta.main) {
  await runMigrations();
  await sql.close();
}
