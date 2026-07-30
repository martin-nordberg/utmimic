/** Creates the `flight_authorizations.waivers` table and its indexes. */
export async function up(sql: Bun.SQL): Promise<void> {
  await sql`
    CREATE TABLE flight_authorizations.waivers (
      waiver_id     text PRIMARY KEY,
      waiver_type   text NOT NULL CHECK (waiver_type IN ('operations_from_moving_vehicle', 'night_operations', 'beyond_visual_line_of_sight', 'operations_over_people')),
      pilot_id      text,
      owner_id      text,
      conditions    text NOT NULL,
      start_time    timestamptz NOT NULL,
      end_time      timestamptz NOT NULL,
      status        text NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed', 'approved', 'rescinded')),
      rescinded_at  timestamptz,
      created_at    timestamptz NOT NULL DEFAULT now(),
      updated_at    timestamptz NOT NULL DEFAULT now(),
      CHECK (end_time > start_time),
      CHECK ((status = 'rescinded') = (rescinded_at IS NOT NULL)),
      CHECK ((pilot_id IS NOT NULL) <> (owner_id IS NOT NULL))
    )
  `;

  await sql`CREATE INDEX ON flight_authorizations.waivers (pilot_id)`;
  await sql`CREATE INDEX ON flight_authorizations.waivers (owner_id)`;
}

/** Drops the `flight_authorizations.waivers` table. */
export async function down(sql: Bun.SQL): Promise<void> {
  await sql`DROP TABLE flight_authorizations.waivers`;
}
