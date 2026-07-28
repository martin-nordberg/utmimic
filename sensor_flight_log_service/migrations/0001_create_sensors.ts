export async function up(sql: Bun.SQL): Promise<void> {
  await sql`
    CREATE TABLE sensor_flight_log.sensors (
      sensor_id             text PRIMARY KEY,
      name                  text NOT NULL,
      notes                 text,
      latitude              double precision NOT NULL,
      longitude             double precision NOT NULL,
      sensing_radius_meters double precision NOT NULL,
      status                text NOT NULL DEFAULT 'offline' CHECK (status IN ('online', 'offline')),
      created_at            timestamptz NOT NULL DEFAULT now(),
      updated_at            timestamptz NOT NULL DEFAULT now()
    )
  `;
}

export async function down(sql: Bun.SQL): Promise<void> {
  await sql`DROP TABLE sensor_flight_log.sensors`;
}
