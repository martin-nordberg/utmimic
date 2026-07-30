/** Creates the `flight_authorizations.flight_plan_waypoints` table and its index. */
export async function up(sql: Bun.SQL): Promise<void> {
  await sql`
    CREATE TABLE flight_authorizations.flight_plan_waypoints (
      flight_plan_id   text NOT NULL REFERENCES flight_authorizations.flight_plans (flight_plan_id),
      sequence_number  integer NOT NULL,
      point            geometry(Point, 4326) NOT NULL,
      altitude_min_ft  double precision NOT NULL,
      altitude_max_ft  double precision NOT NULL,
      radius_meters    double precision NOT NULL,
      PRIMARY KEY (flight_plan_id, sequence_number),
      CHECK (altitude_min_ft >= 0 AND altitude_max_ft <= 2000 AND altitude_min_ft < altitude_max_ft)
    )
  `;

  await sql`CREATE INDEX ON flight_authorizations.flight_plan_waypoints USING GIST (point)`;
}

/** Drops the `flight_authorizations.flight_plan_waypoints` table. */
export async function down(sql: Bun.SQL): Promise<void> {
  await sql`DROP TABLE flight_authorizations.flight_plan_waypoints`;
}
