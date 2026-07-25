---
title: Modules - Live Flight Log Service
description: Web service to read and write simulated live flight data
---

This module is a stand-alone web service that wraps the PostgreSQL `live_flight_log` schema (see [Database](/modules/database/)).
It captures simulated live (ground-truth) positions of flights in progress.
It stores time-series of latitude/longitude/altitude (ft) coordinates keyed by drone serial number.

These are the "true" simulated positions, recorded at finer time intervals and with full precision — as opposed to [Sensor Flight Log Service](/modules/sensor_flight_log_service/), which stores what a remote ID sensor would "see": the same flights sampled at coarser intervals and with simulated positional imprecision.

It is the sole owner of the `live_flight_log` schema: no other module reads or writes those tables directly, and this service also owns the schema's migrations (see [Migrations](#migrations)).

## Technologies

* **Bun** as JavaScript engine and runtime
* **Hono** as web service routing and middleware framework
* **Zod** for data validation
* **@hono/zod-openapi** for request/response validation against Zod schemas plus OpenAPI generation from the same definitions (superset of `@hono/zod-validator`)
* **@paralleldrive/cuid2** for any unique IDs that need generation; clients generate IDs themselves where feasible (e.g. an idempotency key on ingest — see [API](#api))
* **Bun.sql** for PostgreSQL access
* **Pino** for structured (JSON) logging to stdout
* Packaged in a Docker container running a Bun native executable (`bun build --compile`)
* **Bun.test** for unit testing
* Hand-rolled migration runner, written in TypeScript, living inside this module (see [Migrations](#migrations))

## Data model

Preliminary — no tables exist yet in `live_flight_log`; this is a starting design, not a final one.

A single table, `live_flight_log.position_reports`, holds one row per simulated true position:

| Column | Type | Notes |
| --- | --- | --- |
| `report_id` | `text` | Client-generated cuid2, used as an idempotency key (see below) |
| `drone_serial_number` | `text` | Serial number of the simulated drone |
| `recorded_at` | `timestamptz` | Simulated timestamp of the position |
| `latitude` | `double precision` | Degrees |
| `longitude` | `double precision` | Degrees |
| `altitude_ft` | `double precision` | Feet |
| `ingested_at` | `timestamptz` | When this service wrote the row (`default now()`), may lag `recorded_at` |

```sql
CREATE TABLE live_flight_log.position_reports (
    report_id           text PRIMARY KEY,
    drone_serial_number text NOT NULL,
    recorded_at         timestamptz NOT NULL,
    latitude            double precision NOT NULL,
    longitude           double precision NOT NULL,
    altitude_ft         double precision NOT NULL,
    ingested_at         timestamptz NOT NULL DEFAULT now()
);

SELECT create_hypertable('live_flight_log.position_reports', by_range('recorded_at'));

CREATE INDEX ON live_flight_log.position_reports (drone_serial_number, recorded_at DESC);
```

Notes:

- The table is a TimescaleDB hypertable partitioned on `recorded_at`, since this is pure time-series data.
- `latitude`/`longitude` are plain columns for now rather than a PostGIS `geography(Point, 4326)` column — no spatial queries (radius search, geofencing, etc.) are planned yet, so the extra type isn't justified. Revisit if/when this service or a consumer needs spatial querying.
- `report_id` lets ingest clients retry a submission (e.g. after a network timeout) without creating duplicate rows — the insert becomes `ON CONFLICT (report_id) DO NOTHING`.
- Expected write frequency/precision is higher than `sensor_flight_log`'s — the sampling-down and imprecision that emulate a real remote ID sensor happen on the consuming side, not in this service (see [Open questions](#open-questions)).

## API

Preliminary route sketch, mounted under `/api/v1`:

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/drones/{serial}/positions` | Ingest one or more simulated position reports for a drone |
| `GET` | `/drones/{serial}/positions` | Query a drone's position history, filtered by time range |
| `GET` | `/drones/{serial}/positions/latest` | Convenience lookup of the most recent known position |
| `GET` | `/healthz` | Liveness/readiness check for container orchestration |

`POST /drones/{serial}/positions` accepts a single report or an array of reports (a flight simulator may batch several position updates per request):

```json
{
  "reportId": "clh6z9k9x0000qzrm...",
  "recordedAt": "2026-07-25T14:03:11.000Z",
  "latitude": 47.6205,
  "longitude": -122.3493,
  "altitudeFt": 412.5
}
```

`GET /drones/{serial}/positions` supports `from`/`to` (ISO 8601) and `limit` query parameters, returning reports ordered by `recordedAt` ascending.

All request/response shapes are Zod schemas, and `@hono/zod-openapi` derives the OpenAPI document from them, served at `/openapi.json` with Swagger UI at `/docs` for manual exploration.

## Migrations

Migrations are TypeScript files owned by this module, not a separate CLI tool — chosen because this service is the schema's only client, so there's no need for a language-agnostic or multi-consumer migration tool.

- Migration files live in `migrations/`, named `0001_create_position_reports.ts`, `0002_...ts`, etc., each exporting `up(sql)` and `down(sql)` functions that run statements via `Bun.sql`.
- A `live_flight_log.schema_migrations` table tracks which migration filenames have been applied and when.
- A small runner script (`bun run migrate`) reads `migrations/` in order, compares against `schema_migrations`, and applies any pending ones inside a transaction.
- The container runs migrations on startup, before the HTTP server begins listening — acceptable for a single-instance early-stage deployment; revisit (e.g. a separate migrate step/job) if this ever runs with multiple replicas.

## Logging

Pino writes structured (JSON) logs to stdout, one line per log event, ready to be picked up by a future log aggregator without reformatting. `LOG_LEVEL` (see [Configuration](#configuration)) controls verbosity.

## Configuration

Supplied via environment variables:

| Variable | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | yes | Postgres connection string, e.g. `postgres://user:pass@<host>:5432/<db>` pointing at the [Database](/modules/database/) module |
| `PORT` | no | HTTP listen port for the service (default TBD) |
| `LOG_LEVEL` | no | Pino log level, e.g. `info`, `debug` |

As with the database module, secrets are kept out of version control and supplied via environment or a gitignored `.env` file sourced by a future `run-docker.sh`.

## Docker packaging

Following the module convention in the root `CLAUDE.md`, this module gets its own `live_flight_log_service/dockerfile` and `live_flight_log_service/build-docker.sh`, pushing to `mnserver.internal:5000/utmimic-live-flight-log-service:latest`.

Multi-stage build, mirroring the pattern in `documentation/dockerfile`:

1. **Build stage** — `FROM oven/bun:<version>-debian`, `bun install`, then `bun build --compile --outfile server ./src/index.ts` to produce a standalone native executable.
2. **Runtime stage** — a slim base image containing just the compiled binary, running it directly (no Bun runtime needed at runtime since the executable is self-contained).

A `run-docker.sh` for the Kubuntu deployment host, analogous to `database/run-docker.sh`, is deferred until the service has something to deploy.

## Testing

Unit tests use `Bun.test`. Integration tests against a real Postgres instance (rather than mocks) are intended, matching the project's general preference for testing against real dependencies — the exact test-database strategy (ephemeral container, shared dev instance, etc.) is a TODO once there's code to test.

## Open questions

- Service listen port default.
- Authentication/authorization on the ingest endpoint (currently unspecified — anyone who can reach the service can write position reports).
- Retention/archival policy for old position reports (TimescaleDB compression/retention policies are a natural fit once volume matters).
- Batch size limits on `POST /drones/{serial}/positions`.
- What generates the simulated flight paths written here (a separate simulator component?), and where the downsampling/imprecision logic that derives `sensor_flight_log` entries from this data actually lives — not yet designed.
