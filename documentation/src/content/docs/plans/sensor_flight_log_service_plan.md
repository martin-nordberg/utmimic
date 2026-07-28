---
title: Plan - Sensor Flight Log Service
description: Implementation plan for the sensor_flight_log_service module
---

Implementation plan for [`sensor_flight_log_service`](/modules/sensor_flight_log_service/), following the data model, API, and technology choices already fixed in that spec. This document is the ordered build sequence, not a design doc — it doesn't re-litigate decisions already made there.

## Decisions needed before/during implementation

The spec's [Open questions](/modules/sensor_flight_log_service/#open-questions) leaves several things unresolved. Most don't block starting (see phases below), but one is worth pinning down early since it affects code written in Phase 9:

- **Integration test strategy against real Postgres.** The root `CLAUDE.md` rules out `docker run` in local WSL2 dev, so integration tests can't spin up an ephemeral Postgres container the way a Testcontainers-style setup normally would. The realistic options are: (a) point `DATABASE_URL` at the already-running [Database](/modules/database/) module (dev instance on the Kubuntu host, or a local non-Docker Postgres install) and run tests against a disposable schema, or (b) install Postgres directly in the dev environment via a package manager rather than Docker. Pick one before Phase 9 rather than while writing the first integration test.

Everything else in the open-questions list (retention policy, batch size limits, sensor heartbeat/staleness, profile size limits, profile cascade-delete) is fine to leave as a TODO comment in code and revisit later — none of it blocks a first working version.

## Phase 1 — Project scaffolding

Goal: an empty Hono app that starts, listens, and answers `/healthz`.

- Create `sensor_flight_log_service/` at the repo root.
- `bun init` equivalent by hand: `package.json` (name, `type: module`, scripts for `dev`, `test`, `migrate`), `tsconfig.json` matching Bun's strict defaults.
- Install dependencies: `hono`, `zod`, `@hono/zod-openapi`, `@paralleldrive/cuid2`, `pino`.
- Directory layout:
  ```
  sensor_flight_log_service/
    src/
      index.ts        # entrypoint: run migrations, then listen
      app.ts           # Hono app assembly, route mounting
      config.ts
      logger.ts
      db.ts
      routes/
      schemas/
    migrations/
    dockerfile
    build-docker.sh
  ```
- `src/app.ts` exports a Hono app with just `GET /healthz` returning `200`.
- `src/index.ts` calls `serve()` on the app.
- Verify: `bun run src/index.ts` starts the server; `curl localhost:<port>/healthz` returns `200`.

## Phase 2 — Configuration and logging

- `src/config.ts`: parse `process.env` with a small Zod schema for `DATABASE_URL` (required), `PORT` (optional, default `8004`), `LOG_LEVEL` (optional, default `info`). Throw on startup if `DATABASE_URL` is missing.
- `src/logger.ts`: a Pino instance at `LOG_LEVEL`, writing JSON to stdout. No transport/pretty-printing — matches the spec's "ready for a future log aggregator" intent.
- Wire the logger into `src/app.ts` as Hono middleware logging method, path, status, and duration per request.

## Phase 3 — Database access and migration runner

- `src/db.ts`: a single `Bun.sql` instance constructed from `config.DATABASE_URL`, exported for reuse.
- `migrations/0000_create_schema_migrations.ts` (or inline bootstrap in the runner): creates `sensor_flight_log.schema_migrations (filename text primary key, applied_at timestamptz not null default now())` if it doesn't exist.
- `migrations/run.ts`: reads `migrations/*.ts` in filename order, skips any already recorded in `schema_migrations`, and for each pending one runs `up(sql)` and records the filename inside a transaction.
- `package.json` script: `"migrate": "bun run migrations/run.ts"`.
- `src/index.ts` calls the migration runner before `serve()` starts listening, per the spec.
- Verify: running twice in a row is a no-op the second time (idempotent).

## Phase 4 — Schema migrations

Write the three migrations from the spec's [Data model](/modules/sensor_flight_log_service/#data-model), in dependency order (both later tables reference `sensors`):

- `migrations/0001_create_sensors.ts`
- `migrations/0002_create_sensor_profiles.ts`
- `migrations/0003_create_position_reports.ts` — includes `create_hypertable` and the two indexes from the spec.

Each exports `up(sql)`/`down(sql)`. Verify by running `bun run migrate` against the [Database](/modules/database/) module and inspecting `\d sensor_flight_log.*` in `psql`.

## Phase 5 — Zod schemas and OpenAPI scaffolding

- `src/schemas/sensor.ts`, `src/schemas/profile.ts`, `src/schemas/position.ts`: Zod schemas for request/response bodies matching the spec's JSON examples (camelCase field names, mapped to snake_case columns at the query layer).
- Swap `src/app.ts` from plain `Hono` to `@hono/zod-openapi`'s `OpenAPIHono`.
- Mount `/openapi.json` and Swagger UI at `/docs`, per the spec.
- No real routes yet beyond `/healthz` — this phase is just proving the OpenAPI wiring works with one dummy validated route, before building out Phases 6–8 on top of it.

## Phase 6 — Sensor registry endpoints

Implement, in order:

- `POST /sensors` — insert, `409` (or similar) if `sensorId` already exists.
- `GET /sensors` — list all.
- `GET /sensors/{sensorId}` — `404` if missing.
- `PATCH /sensors/{sensorId}` — partial update of `name`/`notes`/`latitude`/`longitude`/`sensingRadiusMeters`/`status`, bumping `updated_at`.

A `src/routes/sensors.ts` module holding the route handlers plus a small repository layer (`src/repositories/sensors.ts`) that wraps the raw `Bun.sql` calls, so route handlers stay thin and the query layer is testable in isolation.

## Phase 7 — Sensor profile endpoints

- `PUT /sensors/{sensorId}/profile` — upsert (`INSERT ... ON CONFLICT (sensor_id) DO UPDATE`), `404` if `sensorId` unknown, accepts any JSON object.
- `GET /sensors/{sensorId}/profile` — `404` if no profile set.
- `DELETE /sensors/{sensorId}/profile`.

Same route/repository split as Phase 6, in `src/routes/profiles.ts` / `src/repositories/profiles.ts`.

## Phase 8 — Position ingestion and query endpoints

- `POST /drones/{serial}/positions` — accept a single report object or an array (spec's batching note); validate each against the `sensors` table exists, returning `404` for a missing `sensor_id`; insert with `ON CONFLICT (recorded_at, report_id) DO NOTHING` for idempotent retries (see the spec's [Data model](/modules/sensor_flight_log_service/#data-model) note on why the primary key is composite).
- `GET /drones/{serial}/positions` — `from`/`to`/`limit` query params, ascending by `recordedAt`, including `sensorId` per row.
- `GET /drones/{serial}/positions/latest`.

`src/routes/positions.ts` / `src/repositories/positions.ts`, same pattern as Phases 6–7.

## Phase 9 — Testing

- Unit tests (`Bun.test`) for Zod schema edge cases (missing fields, wrong types) and any pure logic (e.g. batch-array-or-single normalization in the ingest handler).
- Integration tests against a real Postgres instance, using the strategy picked in [Decisions needed](#decisions-needed-beforeduring-implementation): migrate a disposable schema, exercise each route end-to-end (register a sensor, ingest positions, query them back, tear down).
- Wire `bun test` as the `test` script; no CI runner exists yet in this repo, so this stays a manual/local step for now.

## Phase 10 — Docker packaging

Following the pattern in `../../../../dockerfile` / `../../../../build-docker.sh`:

- `sensor_flight_log_service/dockerfile`: multi-stage.
  1. `FROM oven/bun:<version>-debian AS builder` — `bun install`, then `bun build --compile --outfile server ./src/index.ts`.
  2. Slim runtime stage (e.g. `debian:bookworm-slim` or `gcr.io/distroless/base` if the compiled binary's dependencies allow it) copying just the compiled `server` binary and running it directly — no Bun runtime needed at runtime.
- `sensor_flight_log_service/build-docker.sh`: copy of `../../../../build-docker.sh` with `IMAGE_NAME="utmimic-sensor-flight-log-service"`.
- `run-docker.sh` stays deferred, per the spec, until there's a real deployment target for it.

## Phase 11 — Docs follow-up

Once implementation reveals real answers to things the spec marks preliminary (port number, exact status codes, any schema deviations), update [`sensor_flight_log_service.md`](/modules/sensor_flight_log_service/) to match reality rather than letting the two drift apart. Remove resolved items from its Open questions list as they're settled.
