---
title: Modules - Drone Registrations Service
description: Web service to read and write drone registration records
---

This module is a stand-alone web service that wraps the PostgreSQL `drone_registrations` schema (see [Database](/modules/database/)).

A **drone registration** records: a drone's serial number, make, and model number; its owner; and a validity period (`startDate`/`endDate`). Owners are normalized into their own resource — one owner can hold many registrations — and are either an **individual** or an **organization**. An organization owner can additionally list its individual **pilots**.

Unlike the other services documented so far, this data isn't a high-frequency time series — it's ordinary low-volume relational record-keeping, so there's no TimescaleDB hypertable here, and no PostGIS either (no geometry in this domain).

It is the sole owner of the `drone_registrations` schema: no other module reads or writes those tables directly, and this service also owns the schema's migrations (see [Migrations](#migrations)).

## Technologies

Same stack as the other Bun/Hono services in this project ([Sensor Flight Log Service](/modules/sensor_flight_log_service/), [Live Flight Log Service](/modules/live_flight_log_service/), [Weather Service](/modules/weather_service/)):

* **Bun** as JavaScript engine and runtime
* **Hono** as web service routing and middleware framework
* **Zod** for data validation
* **@hono/zod-openapi** for request/response validation against Zod schemas plus OpenAPI generation from the same definitions
* **@paralleldrive/cuid2** for any unique IDs that need generation; clients generate IDs themselves where feasible (e.g. `ownerId`, `pilotId`, `registrationId` — see [API](#api))
* **Bun.sql** for PostgreSQL access
* **Pino** for structured (JSON) logging to stdout
* Packaged in a Docker container running a Bun native executable (`bun build --compile`)
* **Bun.test** for unit testing
* Hand-rolled migration runner, written in TypeScript, living inside this module (see [Migrations](#migrations))

## Data model

Preliminary — no tables exist yet in `drone_registrations`; this is a starting design, not a final one.

### `owners`

One row per owner, individual or organization. Every owner has a `firstName`/`lastName` — for an individual, that's the owner themselves; for an organization, that's the **primary point-of-contact person**, alongside the `companyName`. "Contact info" for an owner is phone number, a normalized address, *and* email:

| Column | Type | Notes |
| --- | --- | --- |
| `owner_id` | `text` | Client-generated cuid2 |
| `owner_type` | `text` | `'individual'` or `'organization'` |
| `company_name` | `text` | Set only when `owner_type = 'organization'`, enforced by a check constraint |
| `first_name` | `text` | The individual owner, or the organization's primary contact person |
| `last_name` | `text` | ″ |
| `phone_number` | `text` | |
| `address_line1` | `text` | |
| `address_line2` | `text` | Nullable |
| `address_city` | `text` | |
| `address_state` | `text` | |
| `address_zip` | `text` | |
| `email` | `text` | |
| `created_at` | `timestamptz` | `default now()` |
| `updated_at` | `timestamptz` | `default now()`, bumped on every update |

```sql
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
);
```

### `pilots`

One row per individual pilot listed under an organization owner. Contact info here is **phone number only** — no address, no email, unlike owners:

| Column | Type | Notes |
| --- | --- | --- |
| `pilot_id` | `text` | Client-generated cuid2 |
| `organization_owner_id` | `text` | References `owners.owner_id`; only meaningful when that owner's `owner_type = 'organization'` (not enforced at the DB level — see notes) |
| `name` | `text` | |
| `phone_number` | `text` | |
| `license_number` | `text` | Remote pilot license/certificate number |
| `created_at` | `timestamptz` | `default now()` |
| `updated_at` | `timestamptz` | `default now()`, bumped on every update |

```sql
CREATE TABLE drone_registrations.pilots (
    pilot_id               text PRIMARY KEY,
    organization_owner_id  text NOT NULL REFERENCES drone_registrations.owners (owner_id),
    name                   text NOT NULL,
    phone_number           text NOT NULL,
    license_number         text NOT NULL,
    created_at             timestamptz NOT NULL DEFAULT now(),
    updated_at             timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ON drone_registrations.pilots (organization_owner_id);
```

### `drone_registrations`

One row per registration period for a drone. A serial number is **not** the primary key here — the same drone can be registered again later (renewal, ownership change), so a serial number may have several rows across non-overlapping (in principle) date ranges:

| Column | Type | Notes |
| --- | --- | --- |
| `registration_id` | `text` | Client-generated cuid2 |
| `serial_number` | `text` | The drone's serial number; not unique on its own (see above) |
| `make` | `text` | |
| `model_number` | `text` | |
| `owner_id` | `text` | References `owners.owner_id` |
| `start_date` | `date` | |
| `end_date` | `date` | |
| `created_at` | `timestamptz` | `default now()` |
| `updated_at` | `timestamptz` | `default now()`, bumped on every update |

```sql
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
);

CREATE INDEX ON drone_registrations.drone_registrations (serial_number);
CREATE INDEX ON drone_registrations.drone_registrations (owner_id);
```

Notes:

- Nothing here is a hypertable — registrations are created/updated rarely relative to the sensor/weather services' constant report streams, so plain B-tree indexes are enough.
- A registration "is active" if `start_date <= asOf <= end_date` for some date `asOf` — this is computed at query time (see [API](#api)), not stored as a separate status column.
- The DB doesn't prevent two overlapping registration periods for the same `serial_number`, nor does it enforce `pilots.organization_owner_id` actually pointing at an `owner_type = 'organization'` row — both are left to application-level validation for now. See [Open questions](#open-questions).

## API

Preliminary route sketch, mounted under `/api/v1`:

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/owners` | Create an owner (individual or organization) |
| `GET` | `/owners` | List owners |
| `GET` | `/owners/{ownerId}` | Get one owner |
| `PATCH` | `/owners/{ownerId}` | Update an owner's fields |
| `POST` | `/owners/{ownerId}/pilots` | Add a pilot under an organization owner |
| `GET` | `/owners/{ownerId}/pilots` | List an organization's pilots |
| `GET` | `/owners/{ownerId}/pilots/{pilotId}` | Get one pilot |
| `PATCH` | `/owners/{ownerId}/pilots/{pilotId}` | Update a pilot's fields |
| `DELETE` | `/owners/{ownerId}/pilots/{pilotId}` | Remove a pilot |
| `POST` | `/drone-registrations` | Create a registration |
| `GET` | `/drone-registrations` | List registrations, optionally filtered by `serialNumber` or `ownerId` |
| `GET` | `/drone-registrations/{registrationId}` | Get one registration |
| `PATCH` | `/drone-registrations/{registrationId}` | Update a registration's fields |
| `GET` | `/drone-registrations/by-serial/{serialNumber}` | The registration active for a serial number as of `asOf` (default today) |
| `GET` | `/healthz` | Liveness/readiness check for container orchestration |

`POST /owners`, for an organization (`companyName` required; `firstName`/`lastName` are the primary contact person):

```json
{
  "ownerId": "clh6z8h1x0000qzrm...",
  "ownerType": "organization",
  "companyName": "Acme Aerial Services",
  "firstName": "John",
  "lastName": "Smith",
  "phoneNumber": "+1-555-0100",
  "addressLine1": "123 Main St",
  "addressLine2": "Suite 200",
  "addressCity": "Springfield",
  "addressState": "ST",
  "addressZip": "00000",
  "email": "ops@acme.example"
}
```

For an individual, the same shape with `ownerType: "individual"` and no `companyName` (rejected if present).

`POST /owners/{ownerId}/pilots` (rejected with `422` if the owner isn't `organization`-typed):

```json
{
  "pilotId": "clh6z8m2x0001qzrm...",
  "name": "John Pilot",
  "phoneNumber": "+1-555-0102",
  "licenseNumber": "REM-1234567"
}
```

`POST /drone-registrations`:

```json
{
  "registrationId": "clh6z9k9x0000qzrm...",
  "serialNumber": "SN-12345",
  "make": "DJI",
  "modelNumber": "Mavic 3",
  "ownerId": "clh6z8h1x0000qzrm...",
  "startDate": "2026-01-01",
  "endDate": "2027-01-01"
}
```

`GET /drone-registrations/by-serial/{serialNumber}?asOf=2026-07-25` returns the one registration (if any) whose date range covers `asOf`; `404` if none. This is the endpoint other modules (e.g. Authorization Auto Coordination) would use to check "is this drone currently registered."

All request/response shapes are Zod schemas, and `@hono/zod-openapi` derives the OpenAPI document from them, served at `/openapi.json` with Swagger UI at `/docs` for manual exploration.

## Migrations

Migrations are TypeScript files owned by this module, not a separate CLI tool — same rationale and mechanism as the other services (see [Sensor Flight Log Service](/modules/sensor_flight_log_service/#migrations)).

- Migration files live in `migrations/`, named `0001_create_owners.ts`, `0002_create_pilots.ts`, `0003_create_drone_registrations.ts` (`owners` first, since both `pilots` and `drone_registrations` reference it), each exporting `up(sql)` and `down(sql)` functions that run statements via `Bun.sql`.
- A `drone_registrations.schema_migrations` table tracks which migration filenames have been applied and when.
- A small runner script (`bun run migrate`) reads `migrations/` in order, compares against `schema_migrations`, and applies any pending ones inside a transaction.
- The container runs migrations on startup, before the HTTP server begins listening — acceptable for a single-instance early-stage deployment; revisit (e.g. a separate migrate step/job) if this ever runs with multiple replicas.

## Logging

Pino writes structured (JSON) logs to stdout, one line per log event, ready to be picked up by a future log aggregator without reformatting. `LOG_LEVEL` (see [Configuration](#configuration)) controls verbosity.

## Configuration

Supplied via environment variables:

| Variable | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | yes | Postgres connection string, e.g. `postgres://user:pass@<host>:5432/<db>` pointing at the [Database](/modules/database/) module |
| `PORT` | no | HTTP listen port for the service, default `8001` |
| `LOG_LEVEL` | no | Pino log level, e.g. `info`, `debug` |

As with the other services, secrets are kept out of version control and supplied via environment or a gitignored `.env` file sourced by a future `run-docker.sh`.

## Docker packaging

Following the module convention in the root `CLAUDE.md`, this module gets its own `drone_registrations_service/dockerfile` and `drone_registrations_service/build-docker.sh`, pushing to `mnserver.internal:5000/utmimic-drone-registrations-service:latest`.

Multi-stage build, mirroring the pattern in `documentation/dockerfile`:

1. **Build stage** — `FROM oven/bun:<version>-debian`, `bun install`, then `bun build --compile --outfile server ./src/index.ts` to produce a standalone native executable.
2. **Runtime stage** — a slim base image containing just the compiled binary, running it directly (no Bun runtime needed at runtime since the executable is self-contained).

A `run-docker.sh` for the Kubuntu deployment host, analogous to `database/run-docker.sh`, is deferred until the service has something to deploy.

## Testing

Unit tests use `Bun.test`. Integration tests run against the shared dev/test Postgres instance described in [Database](/modules/database/#development-and-test-instance) (port `5431` on the Kubuntu server) rather than mocks, matching the project's general preference for testing against real dependencies. Test setup drops and re-runs this service's own migrations against its schema at the start of a run, rather than a separate wipe mechanism.

## Open questions

- Overlapping registration periods for the same `serial_number` aren't prevented at the DB level — would need a range/exclusion constraint (e.g. `EXCLUDE USING gist` with `btree_gist`) to enforce non-overlap, not added yet.
- `pilots.organization_owner_id` pointing at an `owner_type = 'organization'` row isn't enforced by the schema (a plain `CHECK` can't reference another table) — currently an application-layer validation only; could add a trigger if this needs to be airtight.
- Whether ownership transfer should be a `PATCH` to `owner_id` on an existing registration, or should instead close out the old registration (set `end_date`) and create a new one under the new owner for auditability — not yet decided.
- Whether owners ever need a status/deactivation concept (they're never hard-deleted, and there's no `DELETE /owners/{ownerId}` endpoint, but nothing marks one as no-longer-active either).
- Authentication/authorization on all endpoints (currently unspecified).
- No `country` field on the address — assumed single-country for now; add if this ever needs to support international addresses.
- Whether `pilots.license_number` should be unique across pilots. Left unconstrained for now, since the same real pilot could plausibly be listed under more than one organization (a separate `pilots` row each time) — worth revisiting once it's clear whether that's meant to happen.
