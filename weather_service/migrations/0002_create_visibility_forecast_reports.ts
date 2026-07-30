/** Creates the `weather.visibility_forecast_reports` hypertable and its indexes. */
export async function up(sql: Bun.SQL): Promise<void> {
  await sql`
    CREATE TABLE weather.visibility_forecast_reports (
      report_id   text NOT NULL,
      zone_id     text NOT NULL,
      recorded_at timestamptz NOT NULL,
      state       text NOT NULL CHECK (state IN ('clear', 'cloudy', 'foggy', 'rainy', 'stormy')),
      ceiling_ft  double precision,
      geom        geometry(Polygon, 4326) NOT NULL,
      ingested_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (recorded_at, report_id),
      CHECK ((state = 'foggy') = (ceiling_ft IS NOT NULL))
    )
  `;

  await sql`SELECT create_hypertable('weather.visibility_forecast_reports', by_range('recorded_at'))`;

  await sql`CREATE INDEX ON weather.visibility_forecast_reports (zone_id, recorded_at DESC)`;
  await sql`CREATE INDEX ON weather.visibility_forecast_reports USING GIST (geom)`;
}

/** Drops the `weather.visibility_forecast_reports` table. */
export async function down(sql: Bun.SQL): Promise<void> {
  await sql`DROP TABLE weather.visibility_forecast_reports`;
}
