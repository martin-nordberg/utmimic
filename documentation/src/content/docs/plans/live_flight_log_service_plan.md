---
title: Plan - Live Flight Log Service
description: Implementation plan for the live_flight_log_service module
---

Implementation plan for [`live_flight_log_service`](/modules/live_flight_log_service/), following the data model, API, and technology choices already fixed in that spec. This document is the ordered build sequence, not a design doc — it doesn't re-litigate decisions already made there.

This service is deliberately built as a smaller sibling of [Sensor Flight Log Service](/modules/sensor_flight_log_service/), whose implementation plan is [here](/plans/sensor_flight_log_service_plan/): same stack, same project layout, same middleware and error-handling conventions, minus the `sensors`/`sensor_profiles` tables and everything sensor-related. Where a phase below just says "port from `sensor_flight_log_service`," the referenced code already exists and works — copy and adapt it rather than redesigning from scratch.

Both items below are already resolved — carried over so the reasoning is visible alongside the phases that depend on it, not because anything is still open.

- **Composite primary key on `position_reports`.** `sensor_flight_log_service`'s Phase 4 discovered that TimescaleDB requires any unique constraint on a hypertable to include the partitioning column — `create_hypertable(..., by_range('recorded_at'))` rejects a bare single-column primary key that excludes it. The spec originally gave `position_reports` a plain `report_id text PRIMARY KEY`; it's since been corrected to `PRIMARY KEY (recorded_at, report_id)` (see [Data model](/modules/live_flight_log_service/#data-model)), with `ON CONFLICT (recorded_at, report_id) DO NOTHING` on insert. `report_id` is still a client-generated cuid2 and unique in practice, so this doesn't change the ingest contract, only the constraint/conflict target. Phase 4 below already reflects this.
- **Integration test strategy against real Postgres.** Resolved project-wide by `sensor_flight_log_service`'s Phase 9 (see its plan): point `DATABASE_URL` at the dev/test instance (`mnserver.internal:5431`), and have an integration test drop/recreate the schema and re-run migrations in `beforeAll` before exercising routes end-to-end. Just repeat the pattern here (`src/integration.test.ts` + `src/test-support/reset-db.ts`), per Phase 7 below.

Everything else in the spec's [Open questions](/modules/live_flight_log_service/#open-questions) (auth, retention policy, batch size limits, what generates the simulated flight paths) is fine to leave as-is and revisit later — none of it blocks a first working version.

## Phase 1 — Project scaffolding

Goal: an empty Hono app that starts, listens, and answers `/healthz`.

- Create `live_flight_log_service/` at the repo root.
- `package.json` (name `live_flight_log_service`, `type: module`, scripts for `dev`/`test`/`migrate`) and `tsconfig.json`, copied from `sensor_flight_log_service`'s and adjusted. Dependencies: `hono`, `zod`, `@hono/zod-openapi`, `@hono/swagger-ui`, `@paralleldrive/cuid2`, `pino` (no version needed beyond matching `sensor_flight_log_service`'s current `package.json`).
- Directory layout, matching `sensor_flight_log_service/src/` minus the sensor/profile pieces:
  ```
  live_flight_log_service/
    src/
      index.ts             # entrypoint: run migrations, then listen
      app.ts               # Hono app assembly, route mounting
      openapi-router.ts     # OpenAPIHono factory with the shared validation-error hook
      config.ts
      logger.ts
      db.ts
      routes/
        positions.ts
      repositories/
        positions.ts
      schemas/
        common.ts
        position.ts
      test-support/
        reset-db.ts
    migrations/
      run.ts
    dockerfile
    build-docker.sh
  ```
- `src/app.ts` exports a Hono app with just `GET /healthz` returning `200`.
- `src/index.ts` calls `Bun.serve()` on the app.
- Verify: `bun run src/index.ts` starts the server; `curl localhost:<port>/healthz` returns `200`.

## Phase 2 — Configuration and logging

- `src/config.ts`: Zod schema for `DATABASE_URL` (required), `PORT` (optional, default `8003` per the [port table](/#port-assignments)), `LOG_LEVEL` (optional, default `info`) — same shape as `sensor_flight_log_service/src/config.ts`.
- `src/logger.ts`: Pino instance at `LOG_LEVEL`, JSON to stdout — copy verbatim.
- `src/db.ts`: `export const sql = new SQL(config.DATABASE_URL)` — copy verbatim.
- Wire a request-logging middleware into `src/app.ts` (method/path/status/duration), same as the sibling service.

## Phase 3 — Shared app scaffolding: OpenAPI router, error handling, Content-Type guard

Port these three pieces from `sensor_flight_log_service` as-is — they're app-wide conventions, not sensor-specific:

- `src/openapi-router.ts` — the `createRouter()` factory wrapping `OpenAPIHono` with the `validationErrorHook` that normalizes Zod validation failures to `{ message: string }` / `400`, instead of the library's default `{ success, error }` shape.
- `app.onError` in `src/app.ts` — returns `err.getResponse()` for `HTTPException`, else logs and returns `{ message: 'Internal Server Error' }` / `500`.
- The `Content-Type: application/json` enforcement middleware in `src/app.ts` — `415` for any `POST`/`PUT`/`PATCH` request without a matching `Content-Type`, for the same reason documented in the sibling service (`@hono/zod-openapi` silently skips body validation otherwise).
- `src/schemas/common.ts` — `ErrorSchema`, copy verbatim.
- Mount `/openapi.json` and Swagger UI at `/docs`, title `Live Flight Log Service`.

## Phase 4 — Migration runner and schema migration

- `migrations/run.ts`: same static-import pattern as `sensor_flight_log_service/migrations/run.ts` (required for `bun build --compile` compatibility — a directory-scanning runner crashes in the compiled binary, per that service's Phase 3/9 findings), targeting `live_flight_log.schema_migrations`.
- `migrations/0001_create_position_reports.ts` — single migration, since there's only one table:
  ```sql
  CREATE TABLE live_flight_log.position_reports (
      report_id           text NOT NULL,
      drone_serial_number  text NOT NULL,
      recorded_at          timestamptz NOT NULL,
      latitude             double precision NOT NULL,
      longitude            double precision NOT NULL,
      altitude_ft          double precision NOT NULL,
      ingested_at          timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (recorded_at, report_id)
  );

  SELECT create_hypertable('live_flight_log.position_reports', by_range('recorded_at'));

  CREATE INDEX ON live_flight_log.position_reports (drone_serial_number, recorded_at DESC);
  ```
  (composite primary key per [Decisions needed](#decisions-needed-beforeduring-implementation) above)
- `package.json` script: `"migrate": "bun run migrations/run.ts"`.
- `src/index.ts` runs migrations before `Bun.serve()` starts listening.
- Verify: `bun run migrate` against the [Database](/modules/database/) module, inspect `\d live_flight_log.*` in `psql`, and confirm running it twice is a no-op.

## Phase 5 — Zod schemas

- `src/schemas/position.ts`: `DroneSerialParamSchema`, `CreatePositionReportSchema`/`CreatePositionReportsBodySchema` (single object or array), `PositionReportSchema`, `PositionQuerySchema` (`from`/`to`/`limit`) — same shape as `sensor_flight_log_service/src/schemas/position.ts` minus the `sensorId` field everywhere.

## Phase 6 — Position ingestion and query endpoints

Port `sensor_flight_log_service/src/routes/positions.ts` and `src/repositories/positions.ts`, dropping everything sensor-related:

- `POST /drones/{serial}/positions` — accepts a single report or array (`normalizeToArray`, including the empty-array-is-a-no-op case), inserts via `ON CONFLICT (recorded_at, report_id) DO NOTHING`, returns `201` with only newly inserted reports. No `findMissingSensorIds` step here — there's no sensor registry to validate against, so ingestion never 404s.
- `GET /drones/{serial}/positions` — `from`/`to`/`limit` query params, ascending by `recordedAt`.
- `GET /drones/{serial}/positions/latest` — `200` with the most recent report, or `404` if none exist.

`src/routes/positions.ts` / `src/repositories/positions.ts`, same route/repository split as the sibling service.

## Phase 7 — Testing

- Unit tests (`Bun.test`) for the Zod schemas (`src/schemas/position.test.ts`) and the batch-array-or-single normalization helper, adapted from `sensor_flight_log_service`'s equivalents.
- `src/test-support/reset-db.ts`: drops/recreates the `live_flight_log` schema and re-runs migrations — same pattern as the sibling service, one schema name swapped.
- `src/integration.test.ts`: exercises ingest → retry-is-idempotent → list → latest end-to-end against the real dev/test Postgres instance, plus the Content-Type-guard and validation-error-shape cases the sibling service's integration suite covers. No sensor-registration setup step is needed first, since ingestion here doesn't validate against anything.
- `bun test` as the `test` script.

## Phase 8 — Docker packaging

Following the pattern in `sensor_flight_log_service/dockerfile` / `build-docker.sh`:

- `live_flight_log_service/dockerfile`: multi-stage, `FROM oven/bun:1.3.14-debian AS builder` → `bun install` → `bun build --compile --outfile server ./src/index.ts`, then a `debian:bookworm-slim` runtime stage copying just the compiled binary. `EXPOSE 8003` (this service's port).
- `live_flight_log_service/build-docker.sh`: copy of the sibling's script with `IMAGE_NAME="utmimic-live-flight-log-service"`.
- `.dockerignore` / `.gitignore` excluding `.env`, `node_modules`, build artifacts — copy from the sibling service.
- `run-docker.sh` stays deferred, per the spec, until there's a real deployment target for it.

## Phase 9 — Docs follow-up

- Update [`live_flight_log_service.md`](/modules/live_flight_log_service/) to match implementation reality: remove the "Preliminary — no tables exist yet" caveat, and firm up any other detail that was marked preliminary once real code exists (the composite-primary-key correction from [Decisions needed](#decisions-needed-beforeduring-implementation) is already applied to the spec, so no further change needed there).
- Add `{ label: 'Live Flight Log Service', slug: 'plans/live_flight_log_service_plan' }` to the "Implementation Plans" section of `documentation/astro.config.mjs`'s sidebar, alongside the existing Sensor Flight Log Service entry (the "Modules" sidebar entry for this service is already live).
