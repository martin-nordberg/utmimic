/** Creates the `weather.wind_forecast_reports` hypertable and its indexes. */
export async function up(sql: Bun.SQL): Promise<void> {
  await sql`
    CREATE TABLE weather.wind_forecast_reports (
      report_id   text NOT NULL,
      zone_id     text NOT NULL,
      recorded_at timestamptz NOT NULL,
      state       text NOT NULL CHECK (state IN ('calm', 'slight_winds', 'heavy_winds', 'dangerous_winds')),
      geom        geometry(Polygon, 4326) NOT NULL,
      ingested_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (recorded_at, report_id)
    )
  `;

  await sql`SELECT create_hypertable('weather.wind_forecast_reports', by_range('recorded_at'))`;

  await sql`CREATE INDEX ON weather.wind_forecast_reports (zone_id, recorded_at DESC)`;
  await sql`CREATE INDEX ON weather.wind_forecast_reports USING GIST (geom)`;
}

/** Drops the `weather.wind_forecast_reports` table. */
export async function down(sql: Bun.SQL): Promise<void> {
  await sql`DROP TABLE weather.wind_forecast_reports`;
}
