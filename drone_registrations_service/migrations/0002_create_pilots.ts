/** Creates the `drone_registrations.pilots` table. */
export async function up(sql: Bun.SQL): Promise<void> {
  await sql`
    CREATE TABLE drone_registrations.pilots (
      pilot_id               text PRIMARY KEY,
      organization_owner_id  text NOT NULL REFERENCES drone_registrations.owners (owner_id),
      name                   text NOT NULL,
      phone_number           text NOT NULL,
      license_number         text NOT NULL,
      created_at             timestamptz NOT NULL DEFAULT now(),
      updated_at             timestamptz NOT NULL DEFAULT now()
    )
  `;

  await sql`CREATE INDEX ON drone_registrations.pilots (organization_owner_id)`;
}

/** Drops the `drone_registrations.pilots` table. */
export async function down(sql: Bun.SQL): Promise<void> {
  await sql`DROP TABLE drone_registrations.pilots`;
}
