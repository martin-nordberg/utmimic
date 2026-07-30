import { sql } from '../src/db';
import { logger } from '../src/logger';
import * as m0001CreateAirspaceAuthorizations from './0001_create_airspace_authorizations';
import * as m0002CreateFlightPlans from './0002_create_flight_plans';
import * as m0003CreateFlightPlanWaypoints from './0003_create_flight_plan_waypoints';
import * as m0004CreateWaivers from './0004_create_waivers';

/** A single schema migration module, applying `up` inside a transaction. */
interface Migration {
  up(sql: Bun.SQL): Promise<unknown>;
}

/** Migrations to apply, in order. */
const migrations: { filename: string; module: Migration }[] = [
  { filename: '0001_create_airspace_authorizations.ts', module: m0001CreateAirspaceAuthorizations },
  { filename: '0002_create_flight_plans.ts', module: m0002CreateFlightPlans },
  { filename: '0003_create_flight_plan_waypoints.ts', module: m0003CreateFlightPlanWaypoints },
  { filename: '0004_create_waivers.ts', module: m0004CreateWaivers },
];

/** Applies any not-yet-applied migrations, recording each in `schema_migrations`. */
export async function runMigrations(): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS flight_authorizations.schema_migrations (
      filename text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `;

  const applied = new Set(
    (
      await sql<{ filename: string }[]>`SELECT filename FROM flight_authorizations.schema_migrations`
    ).map((row) => row.filename),
  );

  // migrations is registered by hand above, rather than discovered via readdir/dynamic
  // import: a runtime filesystem scan can't be resolved by bun build --compile, since the
  // compiled binary has no migrations/ directory on disk and a computed import() path can't
  // be statically bundled. Add new migrations to the list above, in order, alongside the file.
  for (const { filename, module } of migrations) {
    if (applied.has(filename)) continue;

    await sql.begin(async (tx) => {
      await module.up(tx);
      await tx`INSERT INTO flight_authorizations.schema_migrations (filename) VALUES (${filename})`;
    });

    logger.info(`Applied migration ${filename}`);
  }
}

if (import.meta.main) {
  await runMigrations();
  await sql.close();
}
