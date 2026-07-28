export async function up(sql: Bun.SQL): Promise<void> {
  await sql`
    CREATE TABLE sensor_flight_log.sensor_profiles (
      sensor_id  text PRIMARY KEY REFERENCES sensor_flight_log.sensors (sensor_id),
      profile    jsonb NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `;
}

export async function down(sql: Bun.SQL): Promise<void> {
  await sql`DROP TABLE sensor_flight_log.sensor_profiles`;
}
