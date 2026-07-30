---
title: Plan - Drone Registrations Service
description: Implementation plan for the drone_registrations_service module
---

Implementation plan for [`drone_registrations_service`](/modules/drone_registrations_service/), following the data model, API, and technology choices already fixed in that spec. This document is the ordered build sequence, not a design doc — it doesn't re-litigate decisions already made there.

This service reuses the project layout, middleware, error-handling, and migration-runner conventions already proven in [Sensor Flight Log Service](/modules/sensor_flight_log_service/), [Live Flight Log Service](/modules/live_flight_log_service/), and [Weather Service](/modules/weather_service/) (plans [here](/plans/sensor_flight_log_service_plan/), [here](/plans/live_flight_log_service_plan/), and [here](/plans/weather_service_plan/)). Where a phase below says "port from `sensor_flight_log_service`," the referenced code already exists and works — copy and adapt it rather than redesigning from scratch. Of the three, `sensor_flight_log_service`'s `sensors`/`sensor_profiles` CRUD (client-chosen ID, `409` on duplicate, `COALESCE`-based `PATCH`, a nested one-to-one sub-resource) is the closest analog to this service's `owners`/`pilots`/`drone-registrations` — this is the first service in the project that's pure relational CRUD with no time-series table, no TimescaleDB hypertable, and no PostGIS.

## Decisions already resolved

The spec's [Open questions](/modules/drone_registrations_service/#open-questions) leaves several things genuinely open (auth, owner deactivation, `country` field, `pilots.license_number` uniqueness, the DB-level overlap/FK constraints) — none of those block a first working version, and the phases below don't touch them. Three things that previously were undecided are now resolved, folded into the spec, and repeated here since they materially shape the phases below:

- **Ownership transfer is close-old-registration-then-create-new, not a `PATCH` to `ownerId`.** `ownerId` and `serialNumber` are immutable on an existing registration; `PATCH /drone-registrations/{registrationId}` only ever touches `make`/`modelNumber`/`startDate`/`endDate`. Transferring ownership is two ordinary calls (`PATCH` the old registration's `endDate`, then `POST` a new registration for the new owner) — no dedicated transfer endpoint, and the two calls aren't atomic (see the spec's Open Questions).
- **Non-overlapping registration periods per `serialNumber` are checked at the application level.** `POST /drone-registrations` (and `PATCH` when `startDate`/`endDate` change) query for an existing row with an overlapping range for the same `serialNumber` and reject with `409` if found. This is a query-then-write check, not a DB constraint — still racy under concurrent writers, which is fine for this project's current single-instance stage (see the spec's Open Questions).
- **A duplicate client-chosen ID (`ownerId`, `pilotId`, `registrationId`) is a `409`.** Same convention as `POST /sensors` in `sensor_flight_log_service` — a real "resource already exists" conflict, not the flight-log services' idempotent-retry ingest pattern (there's no time-series report here to retry).

One additional simplification, not previously flagged as an open question but decided now to keep `PATCH /owners/{ownerId}` well-defined: **`ownerType` and `companyName` are immutable after creation.** `PATCH` only touches `firstName`/`lastName`/`phoneNumber`/the address fields/`email`. This sidesteps "can an individual owner retroactively become an organization" entirely, matching the same "identity fields are immutable, everything else is patchable" shape as the registration decision above. Revisit if a real need to reclassify an owner ever comes up.

## Phase 1 — Project scaffolding

Goal: an empty Hono app that starts, listens, and answers `/healthz`.

- Create `drone_registrations_service/` at the repo root.
- `package.json` (name `drone_registrations_service`, `type: module`, scripts for `dev`/`test`/`migrate`) and `tsconfig.json`, copied from `sensor_flight_log_service`'s and adjusted. Dependencies: `hono`, `zod`, `@hono/zod-openapi`, `@hono/swagger-ui`, `@paralleldrive/cuid2`, `pino`.
- Directory layout, one routes/repository/schema module per resource:
  ```
  drone_registrations_service/
    src/
      index.ts             # entrypoint: run migrations, then listen
      app.ts               # Hono app assembly, route mounting
      openapi-router.ts     # OpenAPIHono factory with the shared validation-error hook
      config.ts
      logger.ts
      db.ts
      routes/
        owners.ts
        pilots.ts
        drone-registrations.ts
      repositories/
        owners.ts
        pilots.ts
        drone-registrations.ts
      schemas/
        common.ts
        owner.ts
        pilot.ts
        drone-registration.ts
      test-support/
        reset-db.ts
    migrations/
      run.ts
    dockerfile
    build-docker.sh
  ```
- `src/app.ts` exports a Hono app with just `GET /healthz` returning `200`.
- `src/index.ts` calls `Bun.serve()` on the app.
- Verify: `bun run src/index.ts` starts the server; `curl localhost:8001/healthz` returns `200`.

## Phase 2 — Configuration and logging

- `src/config.ts`: Zod schema for `DATABASE_URL` (required), `PORT` (optional, default `8001` per the [port table](/#port-assignments)), `LOG_LEVEL` (optional, default `info`) — no service-specific settings beyond that (unlike `weather_service`'s `ZONE_STALE_AFTER_MINUTES`, nothing here needs to be tunable).
- `src/logger.ts`, `src/db.ts` — copy verbatim from `sensor_flight_log_service`.
- Wire a request-logging middleware into `src/app.ts` (method/path/status/duration), same as the sibling services.

## Phase 3 — Shared app scaffolding: OpenAPI router, error handling, Content-Type guard

Port these pieces from `sensor_flight_log_service` as-is — they're app-wide conventions, not domain-specific:

- `src/openapi-router.ts` — the `createRouter()` factory wrapping `OpenAPIHono` with the `validationErrorHook` that normalizes Zod validation failures to `{ message: string }` / `400`.
- `app.onError` in `src/app.ts` — returns `err.getResponse()` for `HTTPException`, else logs and returns `{ message: 'Internal Server Error' }` / `500`.
- The `Content-Type: application/json` enforcement middleware in `src/app.ts` — `415` for any `POST`/`PUT`/`PATCH` request without a matching `Content-Type`.
- `src/schemas/common.ts` — `ErrorSchema`, copy verbatim.
- Mount `/openapi.json` and Swagger UI at `/docs`, title `Drone Registrations Service`.

## Phase 4 — Migrations

- `migrations/run.ts` — same static-import pattern as the sibling services (required for `bun build --compile` compatibility), targeting `drone_registrations.schema_migrations`.
- Three migrations, in dependency order (both `pilots` and `drone_registrations` reference `owners`) — copy the exact `CREATE TABLE`/index statements from the spec's [Data model](/modules/drone_registrations_service/#data-model):
  - `migrations/0001_create_owners.ts`
  - `migrations/0002_create_pilots.ts`
  - `migrations/0003_create_drone_registrations.ts`
- `package.json` script: `"migrate": "bun run migrations/run.ts"`.
- `src/index.ts` runs migrations before `Bun.serve()` starts listening.
- Verify: `bun run migrate` against the [Database](/modules/database/) module, inspect `\d drone_registrations.*` in `psql` (or an ad hoc `Bun.SQL` script, per the pattern used to verify `weather_service`'s migrations), confirm the two `drone_registrations` indexes and the `pilots` index exist, and confirm running it twice is a no-op.

## Phase 5 — Owners endpoints

Port the shape of `sensor_flight_log_service/src/routes/sensors.ts` + `repositories/sensors.ts` directly — same client-chosen-ID-with-409 and `COALESCE`-`PATCH` pattern, different fields:

- `src/schemas/owner.ts`: `OwnerIdParamSchema`; `CreateOwnerSchema` with a `.refine()` enforcing `(ownerType === 'organization') === (companyName !== undefined)`, mirroring the table's `CHECK` constraint (same technique as `weather_service`'s `ceilingFt`/`state` refinement); `UpdateOwnerSchema` covering only `firstName`/`lastName`/`phoneNumber`/the five address fields/`email` (not `ownerType` or `companyName` — see Decisions above); `OwnerSchema` for responses.
- `src/repositories/owners.ts`: `OwnerAlreadyExistsError` (thrown when `insertOwner` hits a unique-violation — catch `err instanceof SQL.PostgresError && err.errno === '23505'`, exactly like `SensorAlreadyExistsError`); `insertOwner`, `listOwners`, `getOwnerById`, `updateOwner` (the `COALESCE` pattern from `sensors.ts`'s `updateSensor`, restricted to the patchable fields above).
- `src/routes/owners.ts`, mounted at `/api/v1/owners`:
  - `POST /` — `201` or `409` (catch `OwnerAlreadyExistsError`).
  - `GET /` — `200`, list all.
  - `GET /{ownerId}` — `200` or `404`.
  - `PATCH /{ownerId}` — `200` or `404`.
- Verify: register an individual and an organization owner (including the `companyName`-required-for-organization `400`), list, fetch, patch, and confirm a duplicate `ownerId` `409`s.

## Phase 6 — Pilots endpoints

Structurally like `sensor_flight_log_service/src/routes/profiles.ts` (a sub-resource nested under an owner path param) but a list-of-many rather than one-to-one, and with an extra business-rule check `profiles.ts` doesn't need:

- `src/schemas/pilot.ts`: `PilotParamsSchema` (`ownerId`/`pilotId`); `CreatePilotSchema`; `UpdatePilotSchema` (`name`/`phoneNumber`/`licenseNumber` — `organizationOwnerId` is immutable, same reasoning as `ownerId` on registrations); `PilotSchema`.
- `src/repositories/pilots.ts`: `PilotOwnerNotFoundError`, `PilotOwnerNotOrganizationError` — `insertPilot` first fetches the owner by id (reusing `owners.ts`'s `getOwnerById`); throws the first error if it's `null`, the second if `ownerType !== 'organization'`; only then inserts (catching a `23505` unique-violation into a third `PilotAlreadyExistsError`, same convention as owners). This is a plain application-level check, not an FK-violation catch like `profiles.ts`'s `ProfileSensorNotFoundError` — the spec's `CHECK` constraint can't express "references an organization-typed row," so there's no DB error to catch, only the manual lookup (see the spec's [Open questions](/modules/drone_registrations_service/#open-questions)). `listPilotsForOwner`, `getPilotById`, `updatePilot`, `deletePilot` round out the module.
- `src/routes/pilots.ts`, mounted at `/api/v1/owners/{ownerId}/pilots` (mount path carries the `ownerId` param, same topology as `profilesRouter`'s mount in `sensor_flight_log_service/src/app.ts`):
  - `POST /` — `201`, `404` (owner doesn't exist), `422` (owner exists but isn't `organization`-typed), or `409` (duplicate `pilotId`).
  - `GET /` — `200`, list the owner's pilots; `404` if the owner itself doesn't exist.
  - `GET /{pilotId}` — `200` or `404`.
  - `PATCH /{pilotId}` — `200` or `404`.
  - `DELETE /{pilotId}` — `204`, idempotent whether or not the pilot existed (same convention as `profiles.ts`'s `DELETE`).
- Verify: adding a pilot under an individual owner `422`s; under a nonexistent owner `404`s; under an organization owner succeeds; list/get/patch/delete all behave; a duplicate `pilotId` `409`s.

## Phase 7 — Drone registrations endpoints

New ground — no sibling precedent for the overlap check, everything else follows the owners pattern:

- `src/schemas/drone-registration.ts`: `RegistrationIdParamSchema`; `CreateDroneRegistrationSchema` with a `.refine()` for `endDate >= startDate` (mirrors the table's `CHECK`, and fails fast before the DB would anyway); `UpdateDroneRegistrationSchema` covering only `make`/`modelNumber`/`startDate`/`endDate`; `DroneRegistrationSchema`; `ListDroneRegistrationsQuerySchema` (`serialNumber`/`ownerId`, both optional, AND'd together if both given); `OwnerDroneRegistrationsQuerySchema` (just `asOf`, optional `z.iso.date()` — the `ownerId` itself comes from the path param, not the query, on the nested route below); `BySerialQuerySchema` (`asOf`, optional `z.iso.date()`, defaulting to today at the repository layer, not in Zod, since "today" isn't a static default).
- `src/repositories/drone-registrations.ts`:
  - `DroneRegistrationAlreadyExistsError` — same `23505` pattern as owners/pilots.
  - `OverlappingRegistrationError` — thrown by a `findOverlappingRegistration(serialNumber, startDate, endDate, excludeRegistrationId?)` helper that both `insertDroneRegistration` and `updateDroneRegistration` (when either date changes) call before writing: `SELECT registration_id FROM drone_registrations.drone_registrations WHERE serial_number = $1 AND start_date <= $3 AND end_date >= $2 AND registration_id != COALESCE($4, '')` (the `excludeRegistrationId` param lets `PATCH` exclude the row being updated from its own overlap check). If a row comes back, throw before attempting the write.
  - `insertDroneRegistration`, `listDroneRegistrations(filter: { serialNumber?, ownerId?, asOf? })` (`WHERE` clauses built the same optional-parameter way as `weather_service`'s history queries: `(${serialNumber} IS NULL OR serial_number = ${serialNumber})`, ANDed — `asOf` adds `AND (${asOf} IS NULL OR (start_date <= ${asOf} AND end_date >= ${asOf}))`; only the flat list route below passes `serialNumber`/`ownerId`, only the nested owner route passes `ownerId`/`asOf`, but it's one function either way), `getDroneRegistrationById`, `updateDroneRegistration` (`COALESCE`-based, calls `findOverlappingRegistration` first only if `patch.startDate` or `patch.endDate` is set), `getActiveRegistrationBySerial(serialNumber, asOf)` — `WHERE serial_number = $1 AND start_date <= $2 AND end_date >= $2 ORDER BY start_date DESC LIMIT 1` (in the pathological case the app-level overlap check somehow missed, `ORDER BY start_date DESC` picks the most recently started one deterministically rather than erroring).
- `src/routes/drone-registrations.ts` exports two routers:
  - `droneRegistrationsRouter`, mounted at `/api/v1/drone-registrations`:
    - `POST /` — `201`, `409` (duplicate `registrationId` **or** overlap — both map to `409`, distinguished only by the error message).
    - `GET /` — `200`, list with optional `serialNumber`/`ownerId` filters.
    - `GET /{registrationId}` — `200` or `404`.
    - `PATCH /{registrationId}` — `200`, `404`, or `409` (new overlap introduced by a date change).
    - `GET /by-serial/{serialNumber}` — `200` or `404`, `?asOf=` optional (default today).
  - `ownerDroneRegistrationsRouter`, mounted at `/api/v1/owners/:ownerId/drone-registrations` (same mount topology as `pilotsRouter` in Phase 6, and for the same reason — this file needs `getOwnerById` from `repositories/owners.ts` for the existence check, exactly like `pilots.ts` does):
    - `GET /` — `200` with the owner's registrations across all their drones (optionally filtered to those active as of `?asOf=`, via the same `listDroneRegistrations` call with `ownerId` fixed from the path), or `404` if the owner doesn't exist.
- Verify: create two non-overlapping registrations for the same serial number (both succeed), attempt a third that overlaps either one (`409`), `PATCH` a date on one such that it would now overlap the other (`409`), confirm `by-serial` resolves the right one for a few different `asOf` values including a gap between registrations (`404`), and confirm `GET /owners/{ownerId}/drone-registrations` returns all of a multi-drone owner's registrations, narrows correctly with `?asOf=`, and `404`s for an unknown `ownerId`.

## Phase 8 — Testing

- Unit tests (`Bun.test`) for the `CreateOwnerSchema`/`CreatePilotSchema`/`CreateDroneRegistrationSchema` refinements (organization requires `companyName`, `endDate >= startDate`) and each list-query schema's optional/coercion behavior.
- `src/test-support/reset-db.ts`: drops/recreates the `drone_registrations` schema and re-runs migrations — same pattern as the sibling services.
- `src/integration.test.ts`: register an individual and an organization owner; add a pilot under each (the individual case `422`s); create overlapping and non-overlapping registrations and confirm the `409`s land correctly; `PATCH` a registration's dates into an overlap and confirm `409`; exercise `by-serial` across a gap between two registrations for the same serial number; register two drones under one owner and confirm `GET /owners/{ownerId}/drone-registrations` returns both, narrows to the right subset with `?asOf=`, and `404`s for an unknown owner; confirm every duplicate-ID case (`owner`, `pilot`, `registration`) `409`s; plus the Content-Type-guard and validation-error-shape cases every sibling integration suite covers.
- `bun test` as the `test` script.

## Phase 9 — Docker packaging

Following the pattern in `sensor_flight_log_service/dockerfile` / `build-docker.sh` (and `weather_service`'s Phase 9, which independently re-verified the same finding):

- `drone_registrations_service/dockerfile`: multi-stage, `FROM oven/bun:1.3.14-debian AS builder` → `bun install` → `bun build --compile --outfile server ./src/index.ts`, then a `debian:bookworm-slim` runtime stage copying just the compiled binary. `EXPOSE 8001` (this service's port).
- `drone_registrations_service/build-docker.sh`: copy of a sibling's script with `IMAGE_NAME="utmimic-drone-registrations-service"`.
- `.dockerignore`/`.gitignore` excluding `.env`, `node_modules`, build artifacts — copy from a sibling service.
- Verify (build-only, no push, matching the `weather_service` Phase 9 convention): `bun build --compile` succeeds and the resulting binary boots standalone; `docker build` succeeds; remove the local test image afterward.
- `run-docker.sh` stays deferred, per the spec, until there's a real deployment target for it.

## Phase 10 — Docs follow-up

- Update [`drone_registrations_service.md`](/modules/drone_registrations_service/) to match implementation reality: remove the "Preliminary — no tables exist yet" caveat and the "Preliminary route sketch" qualifier, firm up the Docker packaging section's Bun image version and `ldd` finding (same as `weather_service`'s Phase 10), and confirm the already-resolved Open Questions entries (ownership transfer, duplicate-ID handling, overlap enforcement) still match what got built.
- Add `{ label: 'Drone Registrations Service', slug: 'plans/drone_registrations_service_plan' }` to the "Implementation Plans" section of `documentation/astro.config.mjs`'s sidebar, alongside the existing entries.
