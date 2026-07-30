/** Creates the `drone_registrations.drone_registrations` table. */
export async function up(sql: Bun.SQL): Promise<void> {
  await sql`
    CREATE TABLE drone_registrations.drone_registrations (
      registration_id text PRIMARY KEY,
      serial_number   text NOT NULL,
      make            text NOT NULL,
      model_number    text NOT NULL,
      owner_id        text NOT NULL REFERENCES drone_registrations.owners (owner_id),
      start_date      date NOT NULL,
      end_date        date NOT NULL,
      created_at      timestamptz NOT NULL DEFAULT now(),
      updated_at      timestamptz NOT NULL DEFAULT now(),
      CHECK (end_date >= start_date)
    )
  `;

  await sql`CREATE INDEX ON drone_registrations.drone_registrations (serial_number)`;
  await sql`CREATE INDEX ON drone_registrations.drone_registrations (owner_id)`;
}

/** Drops the `drone_registrations.drone_registrations` table. */
export async function down(sql: Bun.SQL): Promise<void> {
  await sql`DROP TABLE drone_registrations.drone_registrations`;
}
