/** Creates the `sensor_flight_log.position_reports` hypertable and its indexes. */
export async function up(sql: Bun.SQL): Promise<void> {
  await sql`
    CREATE TABLE sensor_flight_log.position_reports (
      report_id           text NOT NULL,
      sensor_id           text NOT NULL REFERENCES sensor_flight_log.sensors (sensor_id),
      drone_serial_number text NOT NULL,
      recorded_at         timestamptz NOT NULL,
      latitude            double precision NOT NULL,
      longitude           double precision NOT NULL,
      altitude_ft         double precision NOT NULL,
      ingested_at         timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (recorded_at, report_id)
    )
  `;

  await sql`SELECT create_hypertable('sensor_flight_log.position_reports', by_range('recorded_at'))`;

  await sql`CREATE INDEX ON sensor_flight_log.position_reports (drone_serial_number, recorded_at DESC)`;
  await sql`CREATE INDEX ON sensor_flight_log.position_reports (sensor_id, recorded_at DESC)`;
}

/** Drops the `sensor_flight_log.position_reports` table. */
export async function down(sql: Bun.SQL): Promise<void> {
  await sql`DROP TABLE sensor_flight_log.position_reports`;
}
