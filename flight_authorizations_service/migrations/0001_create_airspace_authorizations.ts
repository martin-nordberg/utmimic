/** Creates the `flight_authorizations.airspace_authorizations` table and its indexes. */
export async function up(sql: Bun.SQL): Promise<void> {
  await sql`
    CREATE TABLE flight_authorizations.airspace_authorizations (
      authorization_id text PRIMARY KEY,
      area             geometry(Polygon, 4326) NOT NULL,
      max_altitude_ft  double precision NOT NULL,
      start_time       timestamptz NOT NULL,
      end_time         timestamptz NOT NULL,
      owner_id         text NOT NULL,
      pilot_id         text,
      status           text NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed', 'approved', 'rescinded')),
      rescinded_at     timestamptz,
      created_at       timestamptz NOT NULL DEFAULT now(),
      updated_at       timestamptz NOT NULL DEFAULT now(),
      CHECK (end_time > start_time),
      CHECK ((status = 'rescinded') = (rescinded_at IS NOT NULL)),
      CHECK (max_altitude_ft >= 0 AND max_altitude_ft <= 2000)
    )
  `;

  await sql`CREATE INDEX ON flight_authorizations.airspace_authorizations (owner_id)`;
  await sql`CREATE INDEX ON flight_authorizations.airspace_authorizations USING GIST (area)`;
}

/** Drops the `flight_authorizations.airspace_authorizations` table. */
export async function down(sql: Bun.SQL): Promise<void> {
  await sql`DROP TABLE flight_authorizations.airspace_authorizations`;
}
