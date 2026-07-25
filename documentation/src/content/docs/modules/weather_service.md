---
title: Modules - Weather Service
description: Web service to read and write simulated weather data
---

This module is a stand-alone web service that wraps the PostgreSQL `weather` schema (see [Database](/modules/database/)).

Weather is modeled crudely as moving polygons of two independent kinds:

- **Visibility zones**, each with a state: `Clear`, `Cloudy`, `Foggy` (with a ceiling in ft), `Rainy`, or `Stormy`.
- **Wind zones**, each with a state: `Calm`, `Slight Winds`, `Heavy Winds`, or `Dangerous Winds`.

A zone is a single moving weather system tracked over time: its polygon shape and state can both change from one report to the next, correlated by a zone ID chosen by whatever is generating the data (a future Weather Simulator module, per the architecture overview — not designed yet). This service only stores and serves reports; it does not simulate weather itself.

Each kind of zone has two flavors of report, exposed through **distinct endpoints** rather than a shared one (see [API](#api)):

- **Observed** — the actual state at `recordedAt`. Supports a "latest" convenience query, since there's always one unambiguous most-recent observation — though "latest" only counts a zone as still existing if it has an observed report within the past 30 minutes (see [API](#api)); older zones are treated as dissipated.
- **Forecast** — a predicted state for a `recordedAt` that may be in the future, issued at `ingestedAt`. Has no "latest": a zone can have several forecasts outstanding at once for different future times, so every forecast query requires an explicit target time instead.

It is the sole owner of the `weather` schema: no other module reads or writes those tables directly, and this service also owns the schema's migrations (see [Migrations](#migrations)).

## Technologies

Same stack as [Sensor Flight Log Service](/modules/sensor_flight_log_service/) and [Live Flight Log Service](/modules/live_flight_log_service/), since this is the same kind of Bun/Hono web service wrapping a schema:

* **Bun** as JavaScript engine and runtime
* **Hono** as web service routing and middleware framework
* **Zod** for data validation, including a minimal hand-written schema for GeoJSON `Polygon` objects (rather than pulling in a full GeoJSON validation library for one shape)
* **@hono/zod-openapi** for request/response validation against Zod schemas plus OpenAPI generation from the same definitions
* **@paralleldrive/cuid2** for any unique IDs that need generation; clients generate IDs themselves where feasible (e.g. an idempotency key on ingest — see [API](#api))
* **Bun.sql** for PostgreSQL access, including PostGIS functions (`ST_GeomFromGeoJSON`, `ST_AsGeoJSON`) to convert between the wire format and the stored `geometry` column — no ORM/spatial library needed for this
* **Pino** for structured (JSON) logging to stdout
* Packaged in a Docker container running a Bun native executable (`bun build --compile`)
* **Bun.test** for unit testing
* Hand-rolled migration runner, written in TypeScript, living inside this module (see [Migrations](#migrations))

## Data model

Preliminary — no tables exist yet in `weather`; this is a starting design, not a final one.

Observed and forecast reports get **separate tables**, not a shared table with a type column — following the same reasoning as visibility vs. wind already being separate tables: the API treats them as genuinely distinct resources with different capabilities (only observed has "latest"), so the schema mirrors that 1:1 rather than introducing a column whose meaning is "which of two unrelated query patterns applies to this row." That gives four tables total.

### `visibility_observed_reports`

One row per actual visibility observation:

| Column | Type | Notes |
| --- | --- | --- |
| `report_id` | `text` | Client-generated cuid2, used as an idempotency key |
| `zone_id` | `text` | Correlates a zone's reports over time as it moves/changes; no separate registry table (see notes) |
| `recorded_at` | `timestamptz` | When this observation applies |
| `state` | `text` | `'clear'`, `'cloudy'`, `'foggy'`, `'rainy'`, or `'stormy'` |
| `ceiling_ft` | `double precision` | Set only when `state = 'foggy'`, enforced by a check constraint |
| `geom` | `geometry(Polygon, 4326)` | The zone's shape at `recorded_at` |
| `ingested_at` | `timestamptz` | When this service wrote the row (`default now()`) |

```sql
CREATE TABLE weather.visibility_observed_reports (
    report_id   text PRIMARY KEY,
    zone_id     text NOT NULL,
    recorded_at timestamptz NOT NULL,
    state       text NOT NULL CHECK (state IN ('clear', 'cloudy', 'foggy', 'rainy', 'stormy')),
    ceiling_ft  double precision,
    geom        geometry(Polygon, 4326) NOT NULL,
    ingested_at timestamptz NOT NULL DEFAULT now(),
    CHECK ((state = 'foggy') = (ceiling_ft IS NOT NULL))
);

SELECT create_hypertable('weather.visibility_observed_reports', by_range('recorded_at'));

CREATE INDEX ON weather.visibility_observed_reports (zone_id, recorded_at DESC);
CREATE INDEX ON weather.visibility_observed_reports USING GIST (geom);
```

### `visibility_forecast_reports`

One row per issued visibility forecast — same shape, plus no implicit "latest":

```sql
CREATE TABLE weather.visibility_forecast_reports (
    report_id   text PRIMARY KEY,
    zone_id     text NOT NULL,
    recorded_at timestamptz NOT NULL,
    state       text NOT NULL CHECK (state IN ('clear', 'cloudy', 'foggy', 'rainy', 'stormy')),
    ceiling_ft  double precision,
    geom        geometry(Polygon, 4326) NOT NULL,
    ingested_at timestamptz NOT NULL DEFAULT now(),
    CHECK ((state = 'foggy') = (ceiling_ft IS NOT NULL))
);

SELECT create_hypertable('weather.visibility_forecast_reports', by_range('recorded_at'));

CREATE INDEX ON weather.visibility_forecast_reports (zone_id, recorded_at DESC);
CREATE INDEX ON weather.visibility_forecast_reports USING GIST (geom);
```

Here, `recorded_at` is the time the forecast is *for* (may be in the future) and `ingested_at` is when the forecast was *issued* — a zone can accumulate multiple forecast rows targeting the same or nearby `recorded_at`, issued at different `ingested_at`s, as a forecast gets refined over time.

### `wind_observed_reports` / `wind_forecast_reports`

Same pattern, `state` drawn from the wind enum instead, no `ceiling_ft`:

```sql
CREATE TABLE weather.wind_observed_reports (
    report_id   text PRIMARY KEY,
    zone_id     text NOT NULL,
    recorded_at timestamptz NOT NULL,
    state       text NOT NULL CHECK (state IN ('calm', 'slight_winds', 'heavy_winds', 'dangerous_winds')),
    geom        geometry(Polygon, 4326) NOT NULL,
    ingested_at timestamptz NOT NULL DEFAULT now()
);

SELECT create_hypertable('weather.wind_observed_reports', by_range('recorded_at'));

CREATE INDEX ON weather.wind_observed_reports (zone_id, recorded_at DESC);
CREATE INDEX ON weather.wind_observed_reports USING GIST (geom);

CREATE TABLE weather.wind_forecast_reports (
    report_id   text PRIMARY KEY,
    zone_id     text NOT NULL,
    recorded_at timestamptz NOT NULL,
    state       text NOT NULL CHECK (state IN ('calm', 'slight_winds', 'heavy_winds', 'dangerous_winds')),
    geom        geometry(Polygon, 4326) NOT NULL,
    ingested_at timestamptz NOT NULL DEFAULT now()
);

SELECT create_hypertable('weather.wind_forecast_reports', by_range('recorded_at'));

CREATE INDEX ON weather.wind_forecast_reports (zone_id, recorded_at DESC);
CREATE INDEX ON weather.wind_forecast_reports USING GIST (geom);
```

Notes:

- All four tables are TimescaleDB hypertables partitioned on `recorded_at`, same treatment as the flight-log services' report tables.
- `zone_id` has no identity/registry table of its own (unlike `sensor_flight_log.sensors`) — a weather zone has no attributes beyond what's already in each report (state, shape), so there's nothing to register ahead of time. It plays the same "correlation key with no owning table" role that `drone_serial_number` plays in [Sensor Flight Log Service](/modules/sensor_flight_log_service/#data-model). The same `zone_id` value can appear in both a zone's observed and forecast table (there's no FK between them — nothing enforces or requires that correspondence).
- This is the project's first real use of a PostGIS `geometry` column (the flight-log services deliberately stuck to plain `double precision` lat/lon since they had no spatial-query need yet). Weather zones are the opposite: spatial containment (`ST_Contains`) is the core query need — see the `.../current` endpoints below — hence the `geometry` type and its GIST index from the start.
- `geometry(Polygon, 4326)` (planar, WGS84 degrees) rather than `geography` — simpler and has fuller function support (e.g. `ST_Contains` isn't available on `geography`), which is fine at the regional scale a single weather zone is expected to span. Revisit if zones end up large enough that planar distortion under SRID 4326 becomes inaccurate.
- No idempotency-key table cleanup, retention policy, or zone-lifecycle/expiry mechanism yet — see [Open questions](#open-questions).

## API

Preliminary route sketch, mounted under `/api/v1`. Visibility and wind zones get identical, parallel endpoint shapes; within each, observed and forecast are distinct paths reflecting their different tables and capabilities:

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/visibility-zones/{zoneId}/observed-reports` | Ingest one or more observed reports for a zone |
| `GET` | `/visibility-zones/observed` | Latest observed report per zone (current picture), or as of `at` if given |
| `GET` | `/visibility-zones/observed/current` | Zone(s) whose observed polygon contains a point (`lat`, `lon`), latest or as of `at` |
| `GET` | `/visibility-zones/{zoneId}/observed-reports` | A zone's observed history (`from`/`to`/`limit`) |
| `GET` | `/visibility-zones/{zoneId}/observed-reports/latest` | A zone's single most recent observed report |
| `POST` | `/visibility-zones/{zoneId}/forecast-reports` | Ingest one or more forecast reports for a zone |
| `GET` | `/visibility-zones/forecast` | Each zone's forecast applicable to a **required** `at` — no "latest" |
| `GET` | `/visibility-zones/forecast/current` | Zone(s) whose forecast polygon (for a required `at`) contains a point |
| `GET` | `/visibility-zones/{zoneId}/forecast-reports` | A zone's forecast history (`from`/`to`/`limit`, or a specific `at`) |
| `POST` | `/wind-zones/{zoneId}/observed-reports` | Same shape as visibility, for wind |
| `GET` | `/wind-zones/observed` | ″ |
| `GET` | `/wind-zones/observed/current` | ″ |
| `GET` | `/wind-zones/{zoneId}/observed-reports` | ″ |
| `GET` | `/wind-zones/{zoneId}/observed-reports/latest` | ″ |
| `POST` | `/wind-zones/{zoneId}/forecast-reports` | ″ |
| `GET` | `/wind-zones/forecast` | ″ |
| `GET` | `/wind-zones/forecast/current` | ″ |
| `GET` | `/wind-zones/{zoneId}/forecast-reports` | ″ |
| `GET` | `/healthz` | Liveness/readiness check for container orchestration |

`POST /visibility-zones/{zoneId}/observed-reports` accepts a single report or an array of reports, with the polygon as GeoJSON:

```json
{
  "reportId": "clh6z9k9x0000qzrm...",
  "recordedAt": "2026-07-25T14:03:11.000Z",
  "state": "foggy",
  "ceilingFt": 800,
  "polygon": {
    "type": "Polygon",
    "coordinates": [[
      [-122.42, 47.61], [-122.40, 47.61], [-122.40, 47.63], [-122.42, 47.63], [-122.42, 47.61]
    ]]
  }
}
```

`POST .../forecast-reports` takes the identical body shape (it's a different endpoint, not a different field, that marks it as a forecast). `ceilingFt` is required when `state` is `"foggy"` and rejected otherwise, mirroring the table's check constraint. The `/wind-zones/...` equivalents drop `ceilingFt` and draw `state` from the wind enum instead.

`GET /visibility-zones/observed` returns one entry per zone (its most recent observed report by default) — the "what does the sky look like right now, area-wide" view a map/dashboard would render; pass `?at=<timestamp>` to instead get each zone's most recent observed report **as of** that time (last known state at-or-before `at`). `GET /visibility-zones/observed/current?lat={lat}&lon={lon}` (optionally with `at`) returns whichever zone's observed polygon contains that point.

**Dissipation**: with no `at` given (true "latest"), a zone is only included if its most recent observed report's `recordedAt` is within `ZONE_STALE_AFTER_MINUTES` (default 30 — see [Configuration](#configuration)) of now; a zone that's gone quiet longer than that is treated as dissipated and simply excluded from `/observed`, absent from `/observed/current` point lookups, and `404` from `/{zoneId}/observed-reports/latest`. This is a query-time filter only — rows are never deleted by it (retention is a separate, still-open question below). The window applies only to the no-`at` "latest" case; an explicit `?at=<timestamp>` lookup returns the last known state as-of that time regardless of how long ago it was, since the caller is deliberately asking about the past.

`GET /visibility-zones/forecast` and `.../forecast/current` require `at` (there's no default) and return, per zone, the forecast whose `recordedAt` is closest to `at`; if a zone has multiple forecasts targeting that same `recordedAt` (re-forecasts issued at different times), the most recently issued (`ingestedAt`) wins.

`GET /{...}-zones/{zoneId}/{observed,forecast}-reports` supports `from`/`to` (ISO 8601) and `limit` for a range, or `at` for a single point-in-time lookup using the same "as of" (observed) / "closest `recordedAt`, latest `ingestedAt` wins" (forecast) rules as above.

All request/response shapes are Zod schemas, and `@hono/zod-openapi` derives the OpenAPI document from them, served at `/openapi.json` with Swagger UI at `/docs` for manual exploration.

## Migrations

Migrations are TypeScript files owned by this module, not a separate CLI tool — same rationale and mechanism as the flight-log services (see [Sensor Flight Log Service](/modules/sensor_flight_log_service/#migrations)).

- Migration files live in `migrations/`, named `0001_create_visibility_observed_reports.ts`, `0002_create_visibility_forecast_reports.ts`, `0003_create_wind_observed_reports.ts`, `0004_create_wind_forecast_reports.ts` (order doesn't matter between them — no foreign keys relate the four tables), each exporting `up(sql)` and `down(sql)` functions that run statements via `Bun.sql`.
- A `weather.schema_migrations` table tracks which migration filenames have been applied and when.
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
| `ZONE_STALE_AFTER_MINUTES` | no | How long an observed zone can go unreported before "latest" queries treat it as dissipated (default `30`) |

As with the other services, secrets are kept out of version control and supplied via environment or a gitignored `.env` file sourced by a future `run-docker.sh`.

## Docker packaging

Following the module convention in the root `CLAUDE.md`, this module gets its own `weather_service/dockerfile` and `weather_service/build-docker.sh`, pushing to `mnserver.internal:5000/utmimic-weather-service:latest`.

Multi-stage build, mirroring the pattern in `documentation/dockerfile`:

1. **Build stage** — `FROM oven/bun:<version>-debian`, `bun install`, then `bun build --compile --outfile server ./src/index.ts` to produce a standalone native executable.
2. **Runtime stage** — a slim base image containing just the compiled binary, running it directly (no Bun runtime needed at runtime since the executable is self-contained).

A `run-docker.sh` for the Kubuntu deployment host, analogous to `database/run-docker.sh`, is deferred until the service has something to deploy.

## Testing

Unit tests use `Bun.test`. Integration tests against a real Postgres instance (rather than mocks) are intended, matching the project's general preference for testing against real dependencies — the exact test-database strategy (ephemeral container, shared dev instance, etc.) is a TODO once there's code to test.

## Open questions

- Whether `ZONE_STALE_AFTER_MINUTES` should be a single global value or configurable separately for visibility vs. wind zones (they may naturally move/change at different rates).
- Whether forecast queries need an analogous staleness concept — e.g. should a forecast whose `recordedAt` has long since passed (and was never "refreshed" into an observed report) still be returned by a `.../forecast?at=` query targeting that past time? Currently yes (forecast queries have no staleness filter, only the observed "latest" path does).
- Polygon validity isn't enforced (e.g. via `ST_IsValid`) — a self-intersecting or malformed polygon would be stored as-is.
- Authentication/authorization on the ingest and query endpoints (currently unspecified).
- Retention/archival policy for old reports (TimescaleDB compression/retention policies are a natural fit once volume matters, especially for forecasts, which are pure write-once history once their `recordedAt` has passed).
- Batch size limits on the ingest endpoints.
- The producer of this data (a Weather Simulator module) isn't designed yet — see the architecture overview.
