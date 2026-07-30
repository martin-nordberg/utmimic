---
title: Modules - Drone Registrations Service
description: Web service to read and write drone registration records
---

This module is a stand-alone web service that wraps the PostgreSQL `drone_registrations` schema (see [Database](/modules/database/)).

A **drone registration** records: a drone's serial number, make, and model number; its owner; and a validity period (`startDate`/`endDate`). Owners are normalized into their own resource — one owner can hold many registrations — and are either an **individual** or an **organization**. An organization owner can additionally list its individual **pilots**.

Unlike the other services documented so far, this data isn't a high-frequency time series — it's ordinary low-volume relational record-keeping, so there's no TimescaleDB hypertable here, and no PostGIS either (no geometry in this domain).

It is the sole owner of the `drone_registrations` schema: no other module reads or writes those tables directly, and this service also owns the schema's migrations (see [Migrations](#migrations)).

See the [implementation plan](/plans/drone_registrations_service_plan/) for the ordered build sequence for this module.

## Technologies

Same stack as the other Bun/Hono services in this project ([Sensor Flight Log Service](/modules/sensor_flight_log_service/), [Live Flight Log Service](/modules/live_flight_log_service/), [Weather Service](/modules/weather_service/)):

* **Bun** as JavaScript engine and runtime
* **Hono** as web service routing and middleware framework
* **Zod** for data validation
* **@hono/zod-openapi** for request/response validation against Zod schemas plus OpenAPI generation from the same definitions (superset of `@hono/zod-validator`)
* **@paralleldrive/cuid2** for any unique IDs that need generation; clients generate IDs themselves where feasible (e.g. `ownerId`, `pilotId`, `registrationId` — see [API](#api))
* **Bun.sql** for PostgreSQL access
* **Pino** for structured (JSON) logging to stdout
* Packaged in a Docker container running a Bun native executable (`bun build --compile`)
* **Bun.test** for unit testing
* Hand-rolled migration runner, written in TypeScript, living inside this module (see [Migrations](#migrations))

## Data model

Implemented as described below (migrated and exercised end-to-end by this module's test suite — see [Testing](#testing)).

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

Domain routes are mounted under `/api/v1`; `/healthz`, `/openapi.json`, and `/docs` are top-level infrastructure endpoints and deliberately sit outside that prefix. Every `POST`/`PUT`/`PATCH` request must set `Content-Type: application/json` — enforced by middleware returning `415` otherwise, since `@hono/zod-openapi` silently skips body validation (rather than rejecting the request) when the header doesn't match, per the same finding documented in [Sensor Flight Log Service](/modules/sensor_flight_log_service/#api):

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/api/v1/owners` | Create an owner (individual or organization) |
| `GET` | `/api/v1/owners` | List owners |
| `GET` | `/api/v1/owners/{ownerId}` | Get one owner |
| `PATCH` | `/api/v1/owners/{ownerId}` | Update an owner's fields |
| `POST` | `/api/v1/owners/{ownerId}/pilots` | Add a pilot under an organization owner |
| `GET` | `/api/v1/owners/{ownerId}/pilots` | List an organization's pilots |
| `GET` | `/api/v1/owners/{ownerId}/pilots/{pilotId}` | Get one pilot |
| `PATCH` | `/api/v1/owners/{ownerId}/pilots/{pilotId}` | Update a pilot's fields |
| `DELETE` | `/api/v1/owners/{ownerId}/pilots/{pilotId}` | Remove a pilot |
| `GET` | `/api/v1/owners/{ownerId}/drone-registrations` | An owner's registrations (all drones), optionally filtered to those active as of `asOf` |
| `POST` | `/api/v1/drone-registrations` | Create a registration |
| `GET` | `/api/v1/drone-registrations` | List registrations, optionally filtered by `serialNumber` or `ownerId` |
| `GET` | `/api/v1/drone-registrations/{registrationId}` | Get one registration |
| `PATCH` | `/api/v1/drone-registrations/{registrationId}` | Update `make`/`modelNumber`/`startDate`/`endDate` (`ownerId` and `serialNumber` are immutable — see below) |
| `GET` | `/api/v1/drone-registrations/by-serial/{serialNumber}` | The registration active for a serial number as of `asOf` (default today) |
| `GET` | `/healthz` | Liveness/readiness check for container orchestration |
| `GET` | `/openapi.json` | Generated OpenAPI document |
| `GET` | `/docs` | Swagger UI over `/openapi.json` |

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

For an individual, the same shape with `ownerType: "individual"` and no `companyName` (rejected if present). Returns `201` with the created owner, or `409` if `ownerId` already exists — the same client-chosen-ID convention as `POST /sensors` in [Sensor Flight Log Service](/modules/sensor_flight_log_service/#api), not the flight-log services' idempotent-retry ingest pattern (there's no time-series report here to retry).

`POST /owners/{ownerId}/pilots` (rejected with `422` if the owner isn't `organization`-typed, or `409` if `pilotId` already exists):

```json
{
  "pilotId": "clh6z8m2x0001qzrm...",
  "name": "John Pilot",
  "phoneNumber": "+1-555-0102",
  "licenseNumber": "REM-1234567"
}
```

`GET /owners/{ownerId}/drone-registrations` returns every registration the owner holds or has held, across all their drones (an owner can register more than one) — `404` if the owner itself doesn't exist. This is the nested, discoverable counterpart to `GET /drone-registrations?ownerId={ownerId}` (see below); both return the same rows, but this one 404s on an unknown owner instead of silently returning an empty array, and sits under the owner resource the way `/owners/{ownerId}/pilots` does. Pass `?asOf=2026-07-25` to filter to only the registrations active on that date (an owner with several drones can have more than one match) — omitted, it returns the owner's full registration history, active and expired alike.

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

Returns `201` with the created registration, or `409` if `registrationId` already exists **or** if `[startDate, endDate]` overlaps an existing registration's date range for the same `serialNumber` — enforced at the application layer (a query before insert), not by a DB constraint (see [Open questions](#open-questions)). `PATCH` re-runs the same overlap check, excluding the row being patched itself, whenever `startDate`/`endDate` change.

**Ownership transfer**: `ownerId` is immutable once a registration is created — deliberately, so a registration row's owner reflects who actually held it for that period. Reassigning a drone to a new owner means `PATCH`ing the current registration's `endDate` to the transfer date, then `POST`ing a new registration for the new owner starting the next day — using the two endpoints above, not a dedicated transfer endpoint. This is the same "renewal, ownership change" pattern the [Data model](#data-model) section describes as the reason a `serialNumber` can have several rows. The two calls aren't wrapped in a single transaction (see [Open questions](#open-questions)).

`GET /drone-registrations/by-serial/{serialNumber}?asOf=2026-07-25` returns the one registration (if any) whose date range covers `asOf`; `404` if none. This is the endpoint other modules (e.g. Authorization Auto Coordination) would use to check "is this drone currently registered."

All request/response shapes are Zod schemas, and `@hono/zod-openapi` derives the OpenAPI document from them, served at `/openapi.json` with Swagger UI at `/docs` for manual exploration.

## Migrations

Migrations are TypeScript files owned by this module, not a separate CLI tool — same rationale and mechanism as the other services (see [Sensor Flight Log Service](/modules/sensor_flight_log_service/#migrations)).

- Migration files live in `migrations/`, named `0001_create_owners.ts`, `0002_create_pilots.ts`, `0003_create_drone_registrations.ts` (`owners` first, since both `pilots` and `drone_registrations` reference it), each exporting `up(sql)` and `down(sql)` functions that run statements via `Bun.sql`.
- A `drone_registrations.schema_migrations` table tracks which migration filenames have been applied and when.
- A small runner script (`bun run migrate`) statically imports each migration module and applies any not yet recorded in `schema_migrations`, in order, inside a transaction. The runner deliberately does *not* discover migrations by scanning the `migrations/` directory at runtime: a `bun build --compile` executable has no such directory on disk and can't resolve a dynamic, path-computed `import()` at bundle time, so a directory-scanning runner would crash on startup once packaged — the same finding [Sensor Flight Log Service](/modules/sensor_flight_log_service/#migrations) made, confirmed here too by running the compiled binary standalone. Adding a migration means adding both the file and a one-line registration in `migrations/run.ts`.
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

1. **Build stage** — `FROM oven/bun:1.3.14-debian`, `bun install`, then `bun build --compile --outfile server ./src/index.ts` to produce a standalone native executable.
2. **Runtime stage** — `debian:bookworm-slim`, containing just the compiled binary, run directly (no Bun runtime needed since the executable is self-contained). `ldd` on the compiled binary shows it only depends on glibc/`libpthread`/`libdl`/`libm`, all present in `bookworm-slim` — the same finding [Sensor Flight Log Service](/modules/sensor_flight_log_service/#docker-packaging) made.

A `.dockerignore` excludes `.env`, `node_modules`, and build artifacts from the build context — important here since this service's local `.env` holds real dev database credentials that must never end up baked into an image layer.

A `run-docker.sh` for the Kubuntu deployment host, analogous to `database/run-docker.sh`, is deferred until the service has something to deploy.

## Testing

Unit tests use `Bun.test`. Integration tests run against the shared dev/test Postgres instance described in [Database](/modules/database/#development-and-test-instance) (port `5431` on the Kubuntu server) rather than mocks, matching the project's general preference for testing against real dependencies. Test setup drops and re-runs this service's own migrations against its schema at the start of a run, rather than a separate wipe mechanism.

## Open questions

- Overlapping registration periods for the same `serial_number` aren't prevented at the DB level — would need a range/exclusion constraint (e.g. `EXCLUDE USING gist` with `btree_gist`) to enforce non-overlap. `POST`/`PATCH` do check for it at the application level (see [API](#api)), but that's a query-then-insert race under concurrent writers, not a real constraint; revisit if this ever runs with more than one instance.
- `pilots.organization_owner_id` pointing at an `owner_type = 'organization'` row isn't enforced by the schema (a plain `CHECK` can't reference another table) — currently an application-layer validation only; could add a trigger if this needs to be airtight.
- Ownership transfer (closing the old registration and creating a new one — see [API](#api)) is two separate, non-atomic calls; a failure between them could leave a drone with no active registration for a moment, or two overlapping ones if the second call's overlap check runs before the first call's `PATCH` commits. Acceptable for now given the project's single-instance, no-auth stage; revisit with a single transactional "transfer" endpoint if this needs to be airtight.
- Whether owners ever need a status/deactivation concept (they're never hard-deleted, and there's no `DELETE /owners/{ownerId}` endpoint, but nothing marks one as no-longer-active either).
- Authentication/authorization on all endpoints (currently unspecified).
- No `country` field on the address — assumed single-country for now; add if this ever needs to support international addresses.
- Whether `pilots.license_number` should be unique across pilots. Left unconstrained for now, since the same real pilot could plausibly be listed under more than one organization (a separate `pilots` row each time) — worth revisiting once it's clear whether that's meant to happen.
