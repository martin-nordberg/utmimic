/** Creates the `flight_authorizations.flight_plans` table and its indexes. */
export async function up(sql: Bun.SQL): Promise<void> {
  await sql`
    CREATE TABLE flight_authorizations.flight_plans (
      flight_plan_id             text PRIMARY KEY,
      plan_type                  text NOT NULL CHECK (plan_type IN ('waypoints', 'polygon')),
      owner_id                   text NOT NULL,
      registration_id            text,
      pilot_id                   text,
      airspace_authorization_id  text REFERENCES flight_authorizations.airspace_authorizations (authorization_id),
      start_time                 timestamptz NOT NULL,
      end_time                   timestamptz NOT NULL,
      polygon_area               geometry(Polygon, 4326),
      polygon_max_altitude_ft    double precision,
      created_at                 timestamptz NOT NULL DEFAULT now(),
      updated_at                 timestamptz NOT NULL DEFAULT now(),
      CHECK (end_time > start_time),
      CHECK ((plan_type = 'polygon') = (polygon_area IS NOT NULL)),
      CHECK ((plan_type = 'polygon') = (polygon_max_altitude_ft IS NOT NULL)),
      CHECK (polygon_max_altitude_ft IS NULL OR (polygon_max_altitude_ft >= 0 AND polygon_max_altitude_ft <= 2000))
    )
  `;

  await sql`CREATE INDEX ON flight_authorizations.flight_plans (owner_id)`;
  await sql`CREATE INDEX ON flight_authorizations.flight_plans (registration_id)`;
  await sql`CREATE INDEX ON flight_authorizations.flight_plans (airspace_authorization_id)`;
  await sql`CREATE INDEX ON flight_authorizations.flight_plans USING GIST (polygon_area)`;
}

/** Drops the `flight_authorizations.flight_plans` table. */
export async function down(sql: Bun.SQL): Promise<void> {
  await sql`DROP TABLE flight_authorizations.flight_plans`;
}
