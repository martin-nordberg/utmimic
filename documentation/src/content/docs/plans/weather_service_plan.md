---
title: Plan - Weather Service
description: Implementation plan for the weather_service module
---

Implementation plan for [`weather_service`](/modules/weather_service/), following the data model, API, and technology choices already fixed in that spec. This document is the ordered build sequence, not a design doc — it doesn't re-litigate decisions already made there.

This service reuses the project layout, middleware, error-handling, and migration-runner conventions already proven in [Sensor Flight Log Service](/modules/sensor_flight_log_service/) and [Live Flight Log Service](/modules/live_flight_log_service/) (whose plans are [here](/plans/sensor_flight_log_service_plan/) and [here](/plans/live_flight_log_service_plan/)). Where a phase below says "port from `live_flight_log_service`," the referenced code already exists and works — copy and adapt it rather than redesigning from scratch. Two things are new here and have no sibling precedent to copy: the PostGIS `geometry` column / GeoJSON handling, and the observed-vs-forecast, visibility-vs-wind table fan-out.

- **Composite primary key on all four report tables.** Already corrected in the spec's [Data model](/modules/weather_service/#data-model) before this plan was written — `PRIMARY KEY (recorded_at, report_id)`, not `report_id` alone — for the same TimescaleDB reason `sensor_flight_log_service` and `live_flight_log_service` each hit (a hypertable's unique constraints must include the partitioning column). No rediscovery needed; Phase 4 below builds the corrected schema directly.
- **Integration test strategy against real Postgres.** Resolved project-wide by `sensor_flight_log_service`'s Phase 9: point `DATABASE_URL` at the dev/test instance (`mnserver.internal:5431`), and have an integration test drop/recreate the schema and re-run migrations in `beforeAll` before exercising routes end-to-end. Repeat the pattern here (`src/integration.test.ts` + `src/test-support/reset-db.ts`), per Phase 8 below.

Everything else in the spec's [Open questions](/modules/weather_service/#open-questions) (per-kind staleness windows, forecast staleness, polygon validity, auth, retention, batch limits, the weather simulator itself) is fine to leave as-is and revisit later — none of it blocks a first working version.

Phases 1–10 below are complete: the service is implemented, tested, and containerized as described in the spec. Phase 11 is a net-new addition — the `/sun-times` endpoint — built on top of that finished foundation.

## Phase 1 — Project scaffolding

Goal: an empty Hono app that starts, listens, and answers `/healthz`.

- Create `weather_service/` at the repo root.
- `package.json` (name `weather_service`, `type: module`, scripts for `dev`/`test`/`migrate`) and `tsconfig.json`, copied from `live_flight_log_service`'s and adjusted. Dependencies: `hono`, `zod`, `@hono/zod-openapi`, `@hono/swagger-ui`, `@paralleldrive/cuid2`, `pino` (versions matching the sibling services' current `package.json`).
- Directory layout, matching `live_flight_log_service/src/` but with a routes/repository/schema module per zone kind:
  ```
  weather_service/
    src/
      index.ts             # entrypoint: run migrations, then listen
      app.ts               # Hono app assembly, route mounting
      openapi-router.ts     # OpenAPIHono factory with the shared validation-error hook
      config.ts
      logger.ts
      db.ts
      routes/
        visibility-zones.ts
        wind-zones.ts
      repositories/
        visibility-zones.ts
        wind-zones.ts
      schemas/
        common.ts
        geojson.ts
        visibility-zone.ts
        wind-zone.ts
      test-support/
        reset-db.ts
    migrations/
      run.ts
    dockerfile
    build-docker.sh
  ```
- `src/app.ts` exports a Hono app with just `GET /healthz` returning `200`.
- `src/index.ts` calls `Bun.serve()` on the app.
- Verify: `bun run src/index.ts` starts the server; `curl localhost:8000/healthz` returns `200`.

## Phase 2 — Configuration and logging

- `src/config.ts`: Zod schema for `DATABASE_URL` (required), `PORT` (optional, default `8000` per the [port table](/#port-assignments)), `LOG_LEVEL` (optional, default `info`), `ZONE_STALE_AFTER_MINUTES` (optional, default `30`) — same shape as `live_flight_log_service/src/config.ts` plus the one weather-specific setting.
- `src/logger.ts`: Pino instance at `LOG_LEVEL`, JSON to stdout — copy verbatim.
- `src/db.ts`: `export const sql = new SQL(config.DATABASE_URL)` — copy verbatim.
- Wire a request-logging middleware into `src/app.ts` (method/path/status/duration), same as the sibling services.

## Phase 3 — Shared app scaffolding: OpenAPI router, error handling, Content-Type guard

Port these pieces from `live_flight_log_service` as-is — they're app-wide conventions, not weather-specific:

- `src/openapi-router.ts` — the `createRouter()` factory wrapping `OpenAPIHono` with the `validationErrorHook` that normalizes Zod validation failures to `{ message: string }` / `400`.
- `app.onError` in `src/app.ts` — returns `err.getResponse()` for `HTTPException`, else logs and returns `{ message: 'Internal Server Error' }` / `500`.
- The `Content-Type: application/json` enforcement middleware in `src/app.ts` — `415` for any `POST`/`PUT`/`PATCH` request without a matching `Content-Type`.
- `src/schemas/common.ts` — `ErrorSchema`, copy verbatim.
- Mount `/openapi.json` and Swagger UI at `/docs`, title `Weather Service`.

## Phase 4 — GeoJSON schema and migrations

New ground, not a port:

- `src/schemas/geojson.ts` — a minimal hand-written Zod schema for a GeoJSON `Polygon`: `{ type: z.literal('Polygon'), coordinates: z.array(z.array(z.tuple([z.number(), z.number()]))) }` (an array of linear rings, each ring an array of `[lon, lat]` pairs). Per the spec, this is deliberately narrow — just enough to validate the one shape this service accepts, not a general GeoJSON library. No `ST_IsValid` check yet (open question).
- `migrations/run.ts` — same static-import pattern as the sibling services (required for `bun build --compile` compatibility), targeting `weather.schema_migrations`.
- Four migrations, order doesn't matter between them (no FKs relate the tables) — copy the exact `CREATE TABLE` / `create_hypertable` / index statements from the spec's [Data model](/modules/weather_service/#data-model), which already has the corrected composite primary key:
  - `migrations/0001_create_visibility_observed_reports.ts`
  - `migrations/0002_create_visibility_forecast_reports.ts`
  - `migrations/0003_create_wind_observed_reports.ts`
  - `migrations/0004_create_wind_forecast_reports.ts`
- Confirm the `database/` module's PostGIS extension is enabled in the target database before running these — `geometry` columns and `ST_GeomFromGeoJSON`/`ST_Contains` depend on it (see [Database](/modules/database/)); nothing to do here if it's already bootstrapped, just a thing to check if migration 0001 fails.
- `package.json` script: `"migrate": "bun run migrations/run.ts"`.
- `src/index.ts` runs migrations before `Bun.serve()` starts listening.
- Verify: `bun run migrate` against the [Database](/modules/database/) module, inspect `\d weather.*` in `psql`, confirm the GIST indexes exist, and confirm running it twice is a no-op.

## Phase 5 — Zod schemas and PostGIS read/write helpers

- `src/schemas/visibility-zone.ts` / `src/schemas/wind-zone.ts`: `ZoneIdParamSchema`, `CreateReportSchema`/`CreateReportsBodySchema` (single object or array, embedding the `geojson.ts` polygon schema as `polygon`), `ReportSchema` (response shape, includes `zoneId`), `LatestQuerySchema` (`at` optional), `ForecastQuerySchema` (`at` required), `HistoryQuerySchema` (`from`/`to`/`limit`/`at`), `CurrentQuerySchema` (`lat`/`lon`, plus `at` where applicable). Visibility's schema additionally has `ceilingFt`, required exactly when `state` is `'foggy'` — enforce with a Zod `.refine()`, mirroring the table's `CHECK` constraint.
- A small shared helper (e.g. `src/geo.ts`) wrapping the two PostGIS conversions used everywhere: writing a row passes the polygon through `ST_GeomFromGeoJSON($1)`, reading one back selects `ST_AsGeoJSON(geom)::json AS polygon`. Both repository modules in Phase 6 use this rather than each hand-rolling the SQL fragment.

## Phase 6 — Visibility and wind zone endpoints

Visibility and wind are structurally identical (same query shapes, same table pair, same staleness rule) — implement visibility first, then port it to wind by swapping the state enum and dropping `ceilingFt`, rather than designing the second one from scratch.

For each kind (`src/routes/visibility-zones.ts` + `src/repositories/visibility-zones.ts`, then the `wind-zones` equivalents):

- `POST /{kind}-zones/{zoneId}/observed-reports` and `POST /{kind}-zones/{zoneId}/forecast-reports` — accept a single report or array (`normalizeToArray`, ported from the flight-log services), insert via `ON CONFLICT (recorded_at, report_id) DO NOTHING`, return `201` with only newly inserted reports. No registry check — ingestion never `404`s (per spec).
- `GET /{kind}-zones/observed` — one row per zone, latest by default; `?at=` switches to "most recent as of `at`." Implement as a `DISTINCT ON (zone_id) ... ORDER BY zone_id, recorded_at DESC` query, `recorded_at <= at` (or `<= now()`) as the filter, then apply the staleness cutoff (below) only in the no-`at` case.
- `GET /{kind}-zones/observed/current?lat=&lon=` — same "latest / as of `at`" resolution as above, additionally filtered by `ST_Contains(geom, ST_SetSRID(ST_MakePoint(lon, lat), 4326))`.
- `GET /{kind}-zones/{zoneId}/observed-reports` — `from`/`to`/`limit` history, or a single `at` lookup ("as of" semantics).
- `GET /{kind}-zones/{zoneId}/observed-reports/latest` — `200` with the most recent report (staleness-filtered), or `404`.
- **Staleness**: a small shared predicate (e.g. `recordedAt >= now() - make_interval(mins => $ZONE_STALE_AFTER_MINUTES)`) applied only to the no-`at` "latest" paths (`/observed`, `/observed/current`, `/{zoneId}/observed-reports/latest`), per the spec's dissipation rule. An explicit `?at=` bypasses it entirely.
- `GET /{kind}-zones/forecast` and `.../forecast/current` — `at` is required (`400` if missing, via the Zod schema rather than a manual check); per zone, pick the forecast row with `recorded_at` closest to `at`, breaking ties by highest `ingested_at`. Implement as `DISTINCT ON (zone_id) ... ORDER BY zone_id, abs(extract(epoch FROM recorded_at - $at)), ingested_at DESC`.
- `GET /{kind}-zones/{zoneId}/forecast-reports` — `from`/`to`/`limit`, or a single `at` using the same closest-`recordedAt`/latest-`ingestedAt` resolution.

## Phase 7 — Wind zone endpoints (port from visibility)

Copy Phase 6's visibility routes/repository/schema files, rename to `wind-zones`, swap the state enum to `'calm' | 'slight_winds' | 'heavy_winds' | 'dangerous_winds'`, and drop every `ceilingFt` reference. No new query logic — this phase is purely mechanical if Phase 6 is done first.

## Phase 8 — Testing

- Unit tests (`Bun.test`) for the GeoJSON polygon schema, the visibility `ceilingFt`/`state` refinement, and the batch-array-or-single normalization helper.
- `src/test-support/reset-db.ts`: drops/recreates the `weather` schema and re-runs migrations — same pattern as the sibling services.
- `src/integration.test.ts`: for at least visibility (wind is structurally identical, so a lighter smoke test suffices there) — ingest observed reports for two zones, verify `/observed` returns latest-per-zone, verify `/observed/current` point-in-polygon filtering, verify a zone older than `ZONE_STALE_AFTER_MINUTES` is excluded from `/observed` but still resolvable via `?at=`, ingest a forecast and verify `/forecast?at=` picks the closest `recordedAt`, plus the Content-Type-guard and validation-error-shape cases the sibling services' integration suites cover.
- `bun test` as the `test` script.

## Phase 9 — Docker packaging

Following the pattern in `live_flight_log_service/dockerfile` / `build-docker.sh`:

- `weather_service/dockerfile`: multi-stage, `FROM oven/bun:1.3.14-debian AS builder` → `bun install` → `bun build --compile --outfile server ./src/index.ts`, then a `debian:bookworm-slim` runtime stage copying just the compiled binary. `EXPOSE 8000` (this service's port).
- `weather_service/build-docker.sh`: copy of the sibling's script with `IMAGE_NAME="utmimic-weather-service"`.
- `.dockerignore` / `.gitignore` excluding `.env`, `node_modules`, build artifacts — copy from a sibling service.
- `run-docker.sh` stays deferred, per the spec, until there's a real deployment target for it.

## Phase 10 — Docs follow-up

- Update [`weather_service.md`](/modules/weather_service/) to match implementation reality: remove the "Preliminary — no tables exist yet" caveat and the "Preliminary route sketch" qualifier, and firm up any other detail that was marked preliminary once real code exists.
- Add `{ label: 'Weather Service', slug: 'plans/weather_service_plan' }` to the "Implementation Plans" section of `documentation/astro.config.mjs`'s sidebar, alongside the existing Sensor/Live Flight Log Service entries (the "Modules" sidebar entry for this service is already live).

## Phase 11 — Sun times endpoint

New capability: `GET /api/v1/sun-times`, per the spec's [API](/modules/weather_service/#api) section. This is a pure computation with no backing table — no migration, no repository layer, and no config changes (FAA civil twilight is a fixed -6° sun angle, not something to make configurable).

Uses the `suncalc` package (verified: `suncalc@2.0.1`, types via `@types/suncalc@1.9.2`) rather than hand-rolling the solar-position math — see the spec's [Technologies](/modules/weather_service/#technologies) note on why this one isn't treated like the hand-rolled GeoJSON schema. `suncalc` has no default export — import it as `import * as SunCalc from 'suncalc'`. `SunCalc.getTimes(date, lat, lon)` returns an object whose `dawn`/`sunrise`/`sunset`/`dusk` fields map directly onto this endpoint's four outputs (confirmed against a Seattle date: `dawn` (12:08) precedes `sunrise` (12:44), which precedes `sunset` (03:46 next day UTC), which precedes `dusk` (04:22) — exactly the begin-morning-civil-twilight → sunrise → sunset → end-evening-civil-twilight ordering the spec calls for). At polar latitudes where an event doesn't occur, `suncalc` returns `null` for that field directly (not an `Invalid Date`) — confirmed against Svalbard on both a polar-day and a polar-night date, so passing `null` straight through to the response needs no extra detection logic.

- `package.json`: add `suncalc` to `dependencies` and `@types/suncalc` to `devDependencies`.
- `src/astronomy.ts` — a single function, e.g. `getSunTimes(date: Date, lat: number, lon: number)`, wrapping `SunCalc.getTimes` and mapping its fields to this service's names:
  ```ts
  {
    morningCivilTwilightBeginsAt: dawn,
    sunriseAt: sunrise,
    sunsetAt: sunset,
    eveningCivilTwilightEndsAt: dusk,
  }
  ```
  Each field is `Date | null` at this layer — `null` passed through as-is, a non-null `Date` converted with `.toISOString()`.
- `src/schemas/sun-times.ts`:
  - `SunTimesQuerySchema`: `date: z.iso.date()` (calendar date, `YYYY-MM-DD`), `lat: z.coerce.number()`, `lon: z.coerce.number()` — same unbounded-range convention as the zone `.../current` query schemas (see the spec's Open Questions).
  - `SunTimesSchema`: the four fields above, each `z.iso.datetime().nullable()`.
- `src/routes/sun-times.ts` — a single `GET /` route (no zone param, no repository — calls `astronomy.ts` directly from the handler), mounted in `src/app.ts` at `/api/v1/sun-times` alongside the two zone routers. Parse `date` (`YYYY-MM-DD`) as UTC midnight (`new Date(`${date}T00:00:00Z`)`) before passing to `getSunTimes`.
- Verify: `curl 'localhost:8000/api/v1/sun-times?date=2026-07-30&lat=47.6062&lon=-122.3321'` returns the four ISO timestamps in the dawn < sunrise < sunset < dusk order; a polar-latitude request (e.g. `lat=78.2232&lon=15.6267` on a solstice date) returns all four fields as `null` rather than erroring; `/openapi.json` includes the new path.

### Testing

- Unit tests for `src/astronomy.ts`: the Seattle-date ordering case and the polar-day/polar-night null case above, plus `src/schemas/sun-times.test.ts` for `date`/`lat`/`lon` validation (rejects a non-`YYYY-MM-DD` date, coerces numeric query strings).
- Add a `describe('sun times', ...)` block to `src/integration.test.ts` covering the same two cases end-to-end through `app.request(...)`, plus the existing Content-Type-guard/validation-error-shape conventions (though `/sun-times` is a `GET`-only route, so the Content-Type guard doesn't apply to it — only the validation-error-shape case is relevant here).

### Docs follow-up

Once implemented, update [`weather_service.md`](/modules/weather_service/) the same way Phase 10 did for the rest of the service: nothing here is marked "preliminary," so this is just confirming the spec still matches reality (field mapping, `null` behavior, `suncalc` version) rather than removing caveats.
