/** Creates the `drone_registrations.owners` table. */
export async function up(sql: Bun.SQL): Promise<void> {
  await sql`
    CREATE TABLE drone_registrations.owners (
      owner_id       text PRIMARY KEY,
      owner_type     text NOT NULL CHECK (owner_type IN ('individual', 'organization')),
      company_name   text,
      first_name     text NOT NULL,
      last_name      text NOT NULL,
      phone_number   text NOT NULL,
      address_line1  text NOT NULL,
      address_line2  text,
      address_city   text NOT NULL,
      address_state  text NOT NULL,
      address_zip    text NOT NULL,
      email          text NOT NULL,
      created_at     timestamptz NOT NULL DEFAULT now(),
      updated_at     timestamptz NOT NULL DEFAULT now(),
      CHECK ((owner_type = 'organization') = (company_name IS NOT NULL))
    )
  `;
}

/** Drops the `drone_registrations.owners` table. */
export async function down(sql: Bun.SQL): Promise<void> {
  await sql`DROP TABLE drone_registrations.owners`;
}
