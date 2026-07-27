---
title: Modules - Sensor Flight Log Service
description: Web service to read and write sensor-acquired flight data
---

This module is a stand-alone web service that wraps the PostgreSQL `sensor_flight_log` schema (see [Database](/modules/database/)).
It captures sensor-acquired data about flights in progress from their remote ID broadcasts, tagging each reading with the sensor that produced it.
It stores time-series of latitude/longitude/altitude (ft) coordinates keyed by drone serial number and sensor.

It also owns the registry of sensors themselves — the physical (or, for now, simulated) devices doing the observing: their location, sensing radius, name, notes, and online/offline status. [Sensor Array Simulator](/modules/sensor_array_simulator/) discovers and runs whatever simulated sensors are registered here, rather than defining them itself, so there's a single source of truth for what sensors exist.

Alongside the registry, each sensor may have a **profile**: an arbitrary, application-defined JSON document keyed by sensor ID. This service doesn't interpret the profile's contents — it's a place for whoever registers a sensor to store structured data specific to that sensor (e.g., for a simulated sensor, Sensor Array Simulator's simulation-tuning parameters) without this schema needing to change every time a new attribute is needed.

It is the sole owner of the `sensor_flight_log` schema: no other module reads or writes those tables directly, and this service also owns the schema's migrations (see [Migrations](#migrations)).

See the [implementation plan](/plans/sensor_flight_log_service_plan/) for the ordered build sequence for this module.

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

Preliminary — no tables exist yet in `sensor_flight_log`; this is a starting design, not a final one.

### `sensors`

One row per sensor (physical or simulated):

| Column | Type | Notes |
| --- | --- | --- |
| `sensor_id` | `text` | Client-generated cuid2 (registrant chooses its own ID, same convention as `report_id` below) |
| `name` | `text` | Human-readable name |
| `notes` | `text` | Free-form, nullable |
| `latitude` | `double precision` | Degrees |
| `longitude` | `double precision` | Degrees |
| `sensing_radius_meters` | `double precision` | Coverage radius |
| `status` | `text` | `'online'` or `'offline'`, set explicitly via the API (no heartbeat/timeout logic — see [Open questions](#open-questions)) |
| `created_at` | `timestamptz` | `default now()` |
| `updated_at` | `timestamptz` | `default now()`, bumped on every update |

```sql
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
);
```

Sensors are never hard-deleted (position reports reference them by ID) — a decommissioned sensor is just left `'offline'` indefinitely. `notes` is a free-text place to record that.

### `sensor_profiles`

At most one row per sensor, holding an arbitrary application-defined JSON document:

| Column | Type | Notes |
| --- | --- | --- |
| `sensor_id` | `text` | References `sensors.sensor_id`; primary key (one profile per sensor) |
| `profile` | `jsonb` | Opaque to this service — whatever JSON the client wrote |
| `created_at` | `timestamptz` | `default now()` |
| `updated_at` | `timestamptz` | `default now()`, bumped on every replace |

```sql
CREATE TABLE sensor_flight_log.sensor_profiles (
    sensor_id  text PRIMARY KEY REFERENCES sensor_flight_log.sensors (sensor_id),
    profile    jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
```

`jsonb` (rather than `json`) is used since nothing depends on preserving the exact bytes/key order of what was written, and `jsonb` is cheaper to read back and supports indexing (e.g. GIN) if a future consumer ever needs to query into it — not needed yet, so no such index exists today.

### `position_reports`

One row per sensor-observed position:

| Column | Type | Notes |
| --- | --- | --- |
| `report_id` | `text` | Client-generated cuid2, used as an idempotency key (see below) |
| `sensor_id` | `text` | References `sensors.sensor_id` — which sensor produced this reading |
| `drone_serial_number` | `text` | Remote ID serial number of the reporting drone |
| `recorded_at` | `timestamptz` | When the position was observed (from the remote ID broadcast) |
| `latitude` | `double precision` | Degrees |
| `longitude` | `double precision` | Degrees |
| `altitude_ft` | `double precision` | Feet |
| `ingested_at` | `timestamptz` | When this service wrote the row (`default now()`), may lag `recorded_at` |

```sql
CREATE TABLE sensor_flight_log.position_reports (
    report_id           text PRIMARY KEY,
    sensor_id           text NOT NULL REFERENCES sensor_flight_log.sensors (sensor_id),
    drone_serial_number text NOT NULL,
    recorded_at         timestamptz NOT NULL,
    latitude            double precision NOT NULL,
    longitude           double precision NOT NULL,
    altitude_ft         double precision NOT NULL,
    ingested_at         timestamptz NOT NULL DEFAULT now()
);

SELECT create_hypertable('sensor_flight_log.position_reports', by_range('recorded_at'));

CREATE INDEX ON sensor_flight_log.position_reports (drone_serial_number, recorded_at DESC);
CREATE INDEX ON sensor_flight_log.position_reports (sensor_id, recorded_at DESC);
```

Notes:

- The table is a TimescaleDB hypertable partitioned on `recorded_at`, since this is pure time-series data.
- `latitude`/`longitude` are plain columns for now rather than a PostGIS `geography(Point, 4326)` column — no spatial queries (radius search, geofencing, etc.) are planned yet, so the extra type isn't justified. Revisit if/when this service or a consumer needs spatial querying. This applies to both tables, including `sensors.latitude`/`longitude`.
- `report_id` lets ingest clients retry a submission (e.g. after a network timeout) without creating duplicate rows — the insert becomes `ON CONFLICT (report_id) DO NOTHING`.
- Ingest is rejected with `404` if `sensor_id` doesn't reference a known sensor; this service does not auto-create sensors from ingest traffic.

## API

Preliminary route sketch, mounted under `/api/v1`:

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/sensors` | Register a new sensor |
| `GET` | `/sensors` | List all sensors |
| `GET` | `/sensors/{sensorId}` | Get one sensor |
| `PATCH` | `/sensors/{sensorId}` | Update a sensor's name, notes, location, radius, and/or status |
| `PUT` | `/sensors/{sensorId}/profile` | Create or replace a sensor's profile (arbitrary JSON) |
| `GET` | `/sensors/{sensorId}/profile` | Fetch a sensor's profile |
| `DELETE` | `/sensors/{sensorId}/profile` | Remove a sensor's profile |
| `POST` | `/drones/{serial}/positions` | Ingest one or more position reports for a drone |
| `GET` | `/drones/{serial}/positions` | Query a drone's position history, filtered by time range |
| `GET` | `/drones/{serial}/positions/latest` | Convenience lookup of the most recent known position |
| `GET` | `/healthz` | Liveness/readiness check for container orchestration |

`POST /sensors` registers a sensor with a client-chosen ID (see [Data model](#data-model)):

```json
{
  "sensorId": "clh6z8h1x0000qzrm...",
  "name": "West Ridge",
  "notes": "Mast-mounted, north side of the ridge",
  "latitude": 47.6300,
  "longitude": -122.3600,
  "sensingRadiusMeters": 5000,
  "status": "online"
}
```

`PATCH /sensors/{sensorId}` accepts a partial body with any of `name`, `notes`, `latitude`, `longitude`, `sensingRadiusMeters`, `status` — this is how a sensor (or whatever manages it, e.g. Sensor Array Simulator) flips itself online/offline.

`PUT /sensors/{sensorId}/profile` replaces the sensor's whole profile with the given JSON body — no partial update, since the contents are opaque to this service. For a sensor that [Sensor Array Simulator](/modules/sensor_array_simulator/) is meant to run, whoever registers that sensor would `PUT` its simulation-tuning parameters here (the simulator only reads them):

```json
{
  "pollIntervalMs": { "min": 2000, "max": 5000 },
  "latencyMs": { "min": 200, "max": 1500 },
  "positionErrorStdDev": { "metersHorizontal": 15, "feetVertical": 20 }
}
```

Any JSON object is accepted (validated as `z.record(z.string(), z.unknown())` or similar — just "is this a JSON object," not any particular shape); `404` if `sensorId` doesn't reference a known sensor. `GET` on a sensor with no profile set returns `404`.

`POST /drones/{serial}/positions` accepts a single report or an array of reports (a remote ID receiver may batch several broadcasts per request):

```json
{
  "reportId": "clh6z9k9x0000qzrm...",
  "sensorId": "clh6z8h1x0000qzrm...",
  "recordedAt": "2026-07-25T14:03:11.000Z",
  "latitude": 47.6205,
  "longitude": -122.3493,
  "altitudeFt": 412.5
}
```

`GET /drones/{serial}/positions` supports `from`/`to` (ISO 8601) and `limit` query parameters, returning reports (including which `sensorId` produced each one) ordered by `recordedAt` ascending.

All request/response shapes are Zod schemas, and `@hono/zod-openapi` derives the OpenAPI document from them, served at `/openapi.json` with Swagger UI at `/docs` for manual exploration.

## Migrations

Migrations are TypeScript files owned by this module, not a separate CLI tool — chosen because this service is the schema's only client, so there's no need for a language-agnostic or multi-consumer migration tool.

- Migration files live in `migrations/`, named `0001_create_sensors.ts`, `0002_create_sensor_profiles.ts`, `0003_create_position_reports.ts`, etc. (`sensors` first, since both `sensor_profiles.sensor_id` and `position_reports.sensor_id` reference it), each exporting `up(sql)` and `down(sql)` functions that run statements via `Bun.sql`.
- A `sensor_flight_log.schema_migrations` table tracks which migration filenames have been applied and when.
- A small runner script (`bun run migrate`) reads `migrations/` in order, compares against `schema_migrations`, and applies any pending ones inside a transaction.
- The container runs migrations on startup, before the HTTP server begins listening — acceptable for a single-instance early-stage deployment; revisit (e.g. a separate migrate step/job) if this ever runs with multiple replicas.

## Logging

Pino writes structured (JSON) logs to stdout, one line per log event, ready to be picked up by a future log aggregator without reformatting. `LOG_LEVEL` (see [Configuration](#configuration)) controls verbosity.

## Configuration

Supplied via environment variables:

| Variable | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | yes | Postgres connection string, e.g. `postgres://user:pass@<host>:5432/<db>` pointing at the [Database](/modules/database/) module |
| `PORT` | no | HTTP listen port for the service, default `8004` |
| `LOG_LEVEL` | no | Pino log level, e.g. `info`, `debug` |

As with the database module, secrets are kept out of version control and supplied via environment or a gitignored `.env` file sourced by a future `run-docker.sh`.

## Docker packaging

Following the module convention in the root `CLAUDE.md`, this module gets its own `sensor_flight_log_service/dockerfile` and `sensor_flight_log_service/build-docker.sh`, pushing to `mnserver.internal:5000/utmimic-sensor-flight-log-service:latest`.

Multi-stage build, mirroring the pattern in `documentation/dockerfile`:

1. **Build stage** — `FROM oven/bun:<version>-debian`, `bun install`, then `bun build --compile --outfile server ./src/index.ts` to produce a standalone native executable.
2. **Runtime stage** — a slim base image containing just the compiled binary, running it directly (no Bun runtime needed at runtime since the executable is self-contained).

A `run-docker.sh` for the Kubuntu deployment host, analogous to `database/run-docker.sh`, is deferred until the service has something to deploy.

## Testing

Unit tests use `Bun.test`. Integration tests run against the shared dev/test Postgres instance described in [Database](/modules/database/#development-and-test-instance) (port `5431` on the Kubuntu server) rather than mocks, matching the project's general preference for testing against real dependencies. Test setup drops and re-runs this service's own migrations against its schema at the start of a run, rather than a separate wipe mechanism.

## Open questions

- Authentication/authorization on the ingest and sensor-registry endpoints (currently unspecified — anyone who can reach the service can write position reports or register/modify sensors).
- Retention/archival policy for old position reports (TimescaleDB compression/retention policies are a natural fit once volume matters).
- Batch size limits on `POST /drones/{serial}/positions`.
- Sensor status is explicit-only for now (no heartbeat/staleness detection) — a sensor that crashes without calling `PATCH .../status: offline` will show as `online` indefinitely. Revisit with a `last_seen_at` column and timeout logic if that turns out to matter.
- Any size limit on `sensor_profiles.profile` documents (unbounded JSON blobs from arbitrary clients).
- Whether `sensor_profiles` should cascade-delete if a sensor is ever removed — moot for now since sensors are never hard-deleted (see above).
