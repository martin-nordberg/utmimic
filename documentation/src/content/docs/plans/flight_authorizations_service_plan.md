---
title: Plan - Flight Authorizations Service
description: Implementation plan for the flight_authorizations_service module
---

Implementation plan for [`flight_authorizations_service`](/modules/flight_authorizations_service/), following the data model, API, and technology choices already fixed in that spec. This document is the ordered build sequence, not a design doc — it doesn't re-litigate decisions already made there.

This service reuses the project layout, middleware, error-handling, and migration-runner conventions already proven in [Sensor Flight Log Service](/modules/sensor_flight_log_service/), [Weather Service](/modules/weather_service/), and [Drone Registrations Service](/modules/drone_registrations_service/) (plans [here](/plans/sensor_flight_log_service_plan/), [here](/plans/weather_service_plan/), and [here](/plans/drone_registrations_service_plan/)). Where a phase below says "port from `weather_service`" or "port from `drone_registrations_service`," the referenced code already exists and works — copy and adapt it rather than redesigning from scratch. Two things are new here and have no sibling precedent to copy: a service that calls *another* service's HTTP API at write time (Drone Registrations Service, for cross-service ID validation), and a multi-table write that must be atomic (`flight_plans` + its `flight_plan_waypoints` rows).

## Decisions already resolved

The spec's [Open questions](/modules/flight_authorizations_service/#open-questions) leaves several things genuinely open (auth, retention, `radiusMeters` bounds, the "approved → proposed" revert, whether Drone Registrations Service being unreachable should degrade gracefully) — none of those block a first working version, and the phases below don't touch most of them. One of them *does* need a concrete answer to write any code at all, plus a couple of patchability questions the spec leaves implicit; all three are decided here and repeated since they materially shape the phases below:

- **Drone Registrations Service unreachable → `503`.** A network failure connecting to it, or any `5xx` response from it, is treated as this service's own dependency being down: the write request fails with `503` and a `{ message }` body, not a degraded/best-effort fallback. This resolves the spec's open question pragmatically for a first version — a `DroneRegistrationsServiceUnavailableError` thrown by the client module (Phase 5) is caught at the route layer and mapped to `503`, distinct from the `422`s used for "the ID doesn't exist."
- **Immutable vs. patchable fields, decided per entity, same "identity fields are immutable, everything else is patchable" shape [Drone Registrations Service](/modules/drone_registrations_service/) already established for `owners`/`drone_registrations`:**
  - `airspace_authorizations`: `area` and `ownerId` are immutable after creation. `maxAltitudeFt`, `startTime`, `endTime`, `pilotId`, and `status` are patchable.
  - `flight_plans`: `planType`, `ownerId`, and the shape fields (`waypoints`, or `polygonArea`/`polygonMaxAltitudeFt`) are immutable after creation — no atomic multi-row waypoint replacement to design for. `registrationId`, `pilotId`, `airspaceAuthorizationId`, `startTime`, and `endTime` are patchable.
  - `waivers`: `waiverType`, `pilotId`, and `ownerId` are immutable after creation. `conditions`, `startTime`, `endTime`, and `status` are patchable.
- **A duplicate client-chosen ID (`authorizationId`, `flightPlanId`, `waiverId`) is a `409`.** Same convention as `drone_registrations_service`'s owners/pilots/registrations — a real "resource already exists" conflict.

## Phase 1 — Project scaffolding

Goal: an empty Hono app that starts, listens, and answers `/healthz`.

- Create `flight_authorizations_service/` at the repo root.
- `package.json` (name `flight_authorizations_service`, `type: module`, scripts for `dev`/`test`/`migrate`) and `tsconfig.json`, copied from `weather_service`'s and adjusted. Dependencies: `hono`, `zod`, `@hono/zod-openapi`, `@hono/swagger-ui`, `@paralleldrive/cuid2`, `pino` (versions matching the sibling services' current `package.json`; no `suncalc`-equivalent extra dependency needed here).
- Directory layout, one routes/repository/schema module per resource, plus the two new cross-cutting modules (`geo.ts`, `drone-registrations-client.ts`):
  ```
  flight_authorizations_service/
    src/
      index.ts             # entrypoint: run migrations, then listen
      app.ts               # Hono app assembly, route mounting
      openapi-router.ts     # OpenAPIHono factory with the shared validation-error hook
      config.ts
      logger.ts
      db.ts
      geo.ts                          # PostGIS read/write helpers (ported from weather_service)
      drone-registrations-client.ts   # cross-service ID validation calls
      routes/
        airspace-authorizations.ts
        flight-plans.ts
        waivers.ts
      repositories/
        airspace-authorizations.ts
        flight-plans.ts
        waivers.ts
      schemas/
        common.ts
        geojson.ts
        airspace-authorization.ts
        flight-plan.ts
        waiver.ts
      test-support/
        reset-db.ts
    migrations/
      run.ts
    dockerfile
    build-docker.sh
  ```
- `src/app.ts` exports a Hono app with just `GET /healthz` returning `200`.
- `src/index.ts` calls `Bun.serve()` on the app.
- Verify: `bun run src/index.ts` starts the server; `curl localhost:8002/healthz` returns `200`.

## Phase 2 — Configuration and logging

- `src/config.ts`: Zod schema for `DATABASE_URL` (required), `PORT` (optional, default `8002` per the [port table](/#port-assignments)), `LOG_LEVEL` (optional, default `info`), `DRONE_REGISTRATIONS_SERVICE_URL` (required, no default — this service can't validate cross-service IDs without it).
- `src/logger.ts`, `src/db.ts` — copy verbatim from `weather_service`.
- Wire a request-logging middleware into `src/app.ts` (method/path/status/duration), same as the sibling services.

## Phase 3 — Shared app scaffolding: OpenAPI router, error handling, Content-Type guard

Port these pieces from `weather_service` as-is — they're app-wide conventions, not domain-specific:

- `src/openapi-router.ts` — the `createRouter()` factory wrapping `OpenAPIHono` with the `validationErrorHook` that normalizes Zod validation failures to `{ message: string }` / `400`.
- `app.onError` in `src/app.ts` — returns `err.getResponse()` for `HTTPException`, else logs and returns `{ message: 'Internal Server Error' }` / `500`.
- The `Content-Type: application/json` enforcement middleware in `src/app.ts` — `415` for any `POST`/`PUT`/`PATCH` request without a matching `Content-Type`.
- `src/schemas/common.ts` — `ErrorSchema`, plus `LatitudeSchema` (`z.coerce.number().gt(-90).lt(90)`) and `LongitudeSchema` (`z.coerce.number().gte(-180).lte(180)`), ported from `weather_service`'s Phase 13 (baked in from the start here rather than added later, since the finding that unranged coordinates are a gap is already made).
- Mount `/openapi.json` and Swagger UI at `/docs`, title `Flight Authorizations Service`.

## Phase 4 — GeoJSON schemas and migrations

- `src/schemas/geojson.ts` — two hand-written Zod schemas, both using `LatitudeSchema`/`LongitudeSchema` from `common.ts` for each coordinate:
  - `PolygonSchema` — ported directly from `weather_service/src/schemas/geojson.ts` (an array of linear rings of `[lon, lat]` tuples).
  - `PointSchema` — new, for `flight_plan_waypoints.point`: `{ type: z.literal('Point'), coordinates: z.tuple([LongitudeSchema, LatitudeSchema]) }`. Not exposed directly in request/response bodies (the API's waypoint shape is flat `latitude`/`longitude` fields, per the spec's `POST /flight-plans` example) — used internally by `geo.ts`'s point read/write helpers (Phase 5) and by unit tests.
- `migrations/run.ts` — same static-import pattern as the sibling services (required for `bun build --compile` compatibility), targeting `flight_authorizations.schema_migrations`.
- Four migrations, in dependency order (`flight_plans` references `airspace_authorizations`; `flight_plan_waypoints` references `flight_plans`; `waivers` has no in-schema references) — copy the exact `CREATE TABLE`/index statements from the spec's [Data model](/modules/flight_authorizations_service/#data-model):
  - `migrations/0001_create_airspace_authorizations.ts`
  - `migrations/0002_create_flight_plans.ts`
  - `migrations/0003_create_flight_plan_waypoints.ts`
  - `migrations/0004_create_waivers.ts`
- Confirm the `database/` module's PostGIS extension is enabled in the target database before running these (same check `weather_service`'s Phase 4 made) — nothing to do here if already bootstrapped.
- `package.json` script: `"migrate": "bun run migrations/run.ts"`.
- `src/index.ts` runs migrations before `Bun.serve()` starts listening.
- Verify: `bun run migrate` against the [Database](/modules/database/) module, inspect `\d flight_authorizations.*` in `psql`, confirm the GIST indexes and the `flight_plans` → `airspace_authorizations` / `flight_plan_waypoints` → `flight_plans` FKs exist, and confirm running it twice is a no-op.

## Phase 5 — PostGIS helpers and the Drone Registrations Service client

Two independent pieces of new ground, neither one a port:

- `src/geo.ts` — PostGIS read/write helpers, extending the `weather_service` pattern (`geomFromGeoJson`) with a point variant. Unlike `weather_service`, this service has more than one geometry column (`airspace_authorizations.area`, `flight_plans.polygon_area`, plus a per-waypoint buffered cylinder), so there's no single reusable `polygonSelect`/`ST_Intersects(geom, ...)` constant the way that service has — each repository selects its own named column directly, and the one cross-cutting helper (`intersectsEnvelope`) takes the geometry expression as a parameter instead of assuming a column name:
  - `geomFromGeoJson(polygon: Polygon)` — ported verbatim from `weather_service`.
  - `pointFromLatLon(lat: number, lon: number)` — `sql\`ST_SetSRID(ST_MakePoint(${lon}, ${lat}), 4326)\``, for writing a `flight_plan_waypoints.point` value from the API's flat `latitude`/`longitude` fields.
  - `pointLatLonSelect` — `sql\`ST_Y(point) AS latitude, ST_X(point) AS longitude\``, the inverse, for reading a waypoint row back out. Fine to hardcode the `point` column name since it's the only geometry column ever read this way.
  - `containsPoint(lat, lon)` — `sql\`ST_Contains(area, ST_SetSRID(ST_MakePoint(${lon}, ${lat}), 4326))\``, for `covering`. Hardcodes `area` since authorizations are the only table with a "covering" endpoint.
  - `intersectsEnvelope(geom, minLat, minLon, maxLat, maxLon)` — `sql\`ST_Intersects(${geom}, ST_MakeEnvelope(${minLon}, ${minLat}, ${maxLon}, ${maxLat}, 4326))\``, where `geom` is itself a `sql`-tagged fragment (e.g. `sql\`area\``, `sql\`polygon_area\``, or `sql\`ST_Buffer(point, radius_meters)\``) supplied by the caller — Bun's SQL driver inlines a nested `sql` fragment as raw SQL when interpolated into another one, the same composition technique `weather_service`'s `spatialFilterCondition` relies on, so this isn't string concatenation. Column-agnostic because, unlike `covering`, `intersecting` runs against three different geometries (`airspace_authorizations.area`, `flight_plans.polygon_area`, and each waypoint's buffered cylinder) rather than one. Unlike `weather_service`'s `.../current`, there's no point-or-extent choice to make here — `covering` is always a point, `intersecting` is always a box, per the spec — so no `SpatialFilter` union type is needed.
  - Verified against the live dev/test database: `containsPoint`/`intersectsEnvelope` correctly hit/miss for points and boxes inside/outside a test polygon, the waypoint point round-trips through `pointFromLatLon`/`pointLatLonSelect`, and `intersectsEnvelope` composes correctly over both a plain column (`area`) and a computed expression (`ST_Buffer(point, radius_meters)`).
- `src/drone-registrations-client.ts` — thin `fetch` wrapper around [Drone Registrations Service](/modules/drone_registrations_service/)'s API (`config.DRONE_REGISTRATIONS_SERVICE_URL`):
  - `DroneRegistrationsServiceUnavailableError` — thrown when the `fetch` call itself rejects (network error) or the response status is `>= 500`. See the resolved decision above for why this maps to `503` rather than a fallback.
  - A private `get(path)` helper does the `fetch` call and classifies network errors / `5xx` into `DroneRegistrationsServiceUnavailableError`; each exported function calls it and then does its own `200`/`404`/etc. interpretation on top, since the four calls have different success shapes (boolean existence vs. an extracted field).
  - `ownerExists(ownerId): Promise<boolean>` — `GET /api/v1/owners/{ownerId}`, `true` iff `200`.
  - `pilotExistsUnderOwner(ownerId, pilotId): Promise<boolean>` — `GET /api/v1/owners/{ownerId}/pilots/{pilotId}`, `true` iff `200`.
  - `pilotExistsStandalone(pilotId): Promise<boolean>` — `GET /api/v1/pilots/{pilotId}` (the endpoint added to that service specifically for this — see [Drone Registrations Service](/modules/drone_registrations_service/)'s Phase 11), `true` iff `200`.
  - `getRegistrationOwnerId(registrationId): Promise<string | null>` — `GET /api/v1/drone-registrations/{registrationId}`, returns the registration's `ownerId` on `200`, `null` on `404`.
- Unit tests for `drone-registrations-client.ts` mock `fetch` (the only place in this service's test suite that mocks anything, since everything else is a real Postgres integration test — justified because this is a call to a *different service* over the network, not this service's own dependency) to cover the `200`/`404`/`5xx`/network-error cases.

## Phase 6 — Airspace authorizations endpoints

New ground — no sibling precedent for the status lifecycle + spatial queries combination, though each half individually resembles something a sibling already does (`waivers`' upcoming status lifecycle in Phase 8 mirrors this one; `weather_service`'s zone queries resemble `covering`/`intersecting`):

- `src/schemas/airspace-authorization.ts`: `AuthorizationIdParamSchema`; `StatusSchema` (`z.enum(['proposed', 'approved', 'rescinded'])`); `CreateAirspaceAuthorizationSchema` (`authorizationId`, `area` (`PolygonSchema`), `maxAltitudeFt`, `startTime`, `endTime`, `ownerId`, `pilotId` nullable) with a `.refine()` for `endTime > startTime`; `UpdateAirspaceAuthorizationSchema` covering only `maxAltitudeFt`/`startTime`/`endTime`/`pilotId`/`status` (see Decisions above); `AirspaceAuthorizationSchema` (response, includes `rescindedAt`); `ListAirspaceAuthorizationsQuerySchema` (`ownerId`/`pilotId`/`activeAt`/`status`, all optional); `CoveringQuerySchema` (`lat`/`lon` required via `LatitudeSchema`/`LongitudeSchema`, `at`/`altitudeFt`/`status` optional); `IntersectingQuerySchema` (`minLat`/`minLon`/`maxLat`/`maxLon` required, `altitudeFt`/`at`/`status` optional).
- `src/repositories/airspace-authorizations.ts`:
  - `AuthorizationAlreadyExistsError` — `23505` catch, same pattern as `drone_registrations_service`'s owners/pilots.
  - `OwnerNotFoundError`, `PilotNotFoundError` — thrown by `insertAirspaceAuthorization` after calling `ownerExists`/`pilotExistsUnderOwner` (Phase 5) and finding either missing; only then does the `INSERT` run (using `geomFromGeoJson`).
  - `RescindedIsTerminalError` — thrown by `updateAirspaceAuthorization` if the existing row's `status` is already `'rescinded'` and the patch tries to change `status` again.
  - `insertAirspaceAuthorization`, `listAirspaceAuthorizations(filter)` (optional-parameter `WHERE` clauses, same `(${x} IS NULL OR col = ${x})` technique `weather_service`'s repositories use), `getAirspaceAuthorizationById`, `updateAirspaceAuthorization` (`COALESCE`-based; when `patch.status === 'rescinded'`, also sets `rescinded_at = now()` in the same statement), `listCoveringAuthorizations(lat, lon, at, altitudeFt?, status?)` (`WHERE containsPoint(...) AND start_time <= at AND end_time >= at`, plus the optional altitude/status filters), `listIntersectingAuthorizations(bbox, altitudeFt?, at?, status?)` (`WHERE intersectsEnvelope(...)`, plus optional filters).
- `src/routes/airspace-authorizations.ts`, mounted at `/api/v1/airspace-authorizations`:
  - `POST /` — `201`, `422` (`ownerId`/`pilotId` not found — via Drone Registrations Service), `503` (that service unreachable), or `409` (duplicate `authorizationId`).
  - `GET /` — `200`, list with the four optional filters.
  - `GET /{authorizationId}` — `200` or `404`.
  - `PATCH /{authorizationId}` — `200`, `404`, `422` (new `pilotId` not found), `503`, or `409` (`status` change attempted on an already-`'rescinded'` row).
  - `GET /covering` — `200` with the matching authorizations (empty array if none) — mounted *before* `/{authorizationId}` in route registration order so `covering` isn't swallowed by the param route.
  - `GET /intersecting` — `200`, same ordering caveat.
- Verify: create an authorization (owner/pilot both validated against a running Drone Registrations Service instance — start it locally per its own dev workflow for this), confirm `422` for an unknown `ownerId`, confirm `409` for a duplicate `authorizationId`, `PATCH` through `proposed → approved → rescinded` and confirm a further `PATCH` `409`s, confirm `covering` finds a point inside the polygon and misses one outside, confirm `intersecting` finds/misses correctly for a bounding box, and confirm both filter correctly by `status`/`altitudeFt`.

## Phase 7 — Flight plans endpoints

New ground — the discriminated waypoints/polygon shape and the atomic multi-row waypoint insert have no sibling precedent:

- `src/schemas/flight-plan.ts`: `FlightPlanIdParamSchema`; `WaypointSchema` (`latitude`, `longitude`, `altitudeMinFt`, `altitudeMaxFt`, `radiusMeters`) with a `.refine()` for `altitudeMaxFt > altitudeMinFt`; a discriminated union on `planType` for `CreateFlightPlanSchema` — the `'waypoints'` branch requires `waypoints: z.array(WaypointSchema).min(1)` and forbids `polygonArea`/`polygonMaxAltitudeFt`, the `'polygon'` branch requires `polygonArea`/`polygonMaxAltitudeFt` and forbids `waypoints` (`z.discriminatedUnion('planType', [...])`, each branch its own `z.object`); both branches share `flightPlanId`/`ownerId`/`registrationId`/`pilotId`/`airspaceAuthorizationId`/`startTime`/`endTime`, plus the same `endTime > startTime` refine; `UpdateFlightPlanSchema` covering only `registrationId`/`pilotId`/`airspaceAuthorizationId`/`startTime`/`endTime` (see Decisions above — shape and `ownerId` are immutable); `FlightPlanSchema` (response — includes `waypoints: WaypointSchema[]` when `planType === 'waypoints'`, `polygonArea`/`polygonMaxAltitudeFt` when `'polygon'`); `ListFlightPlansQuerySchema` (`ownerId`/`registrationId`/`pilotId`/`airspaceAuthorizationId`/`activeAt`); `FlightPlanIntersectingQuerySchema` (`minLat`/`minLon`/`maxLat`/`maxLon` required, `altitudeFt`/`activeAt` optional — no `status`, per the spec, flight plans don't have one).
- `src/repositories/flight-plans.ts`:
  - `FlightPlanAlreadyExistsError`, `OwnerNotFoundError`, `PilotNotFoundError`, `RegistrationNotFoundError`, `RegistrationOwnerMismatchError` (thrown when the registration exists but its `ownerId` doesn't match the given `ownerId`), `AirspaceAuthorizationNotFoundError` (when a given `airspaceAuthorizationId` doesn't reference an existing row — this one's a same-schema FK, so this can also just be a Postgres FK-violation catch, `errno === '23503'`, same technique `sensor_flight_log_service`'s `ProfileSensorNotFoundError` uses, rather than a pre-check call).
  - `insertFlightPlan(input)` — validates `ownerId`/`pilotId`/`registrationId` against Drone Registrations Service first (Phase 5), then runs the whole write in one `sql.begin(async (tx) => { ... })` transaction (the migration runner's transaction pattern, reused here for the first time in application code, not just migrations): insert the `flight_plans` row (catching `23505` → `FlightPlanAlreadyExistsError`, `23503` on `airspace_authorization_id` → `AirspaceAuthorizationNotFoundError`), then — only for `planType === 'waypoints'` — insert each waypoint row (using `pointFromLatLon`) with its `sequence_number` taken from array index. Both inserts commit together or not at all.
  - `listFlightPlans(filter)`, `getFlightPlanById(flightPlanId)` (joins/queries `flight_plan_waypoints` too when `planType === 'waypoints'`, using `pointLatLonSelect`, ordered by `sequence_number`), `updateFlightPlan(flightPlanId, patch)` (`COALESCE`-based, only touching the patchable fields; re-validates `pilotId`/`registrationId` against Drone Registrations Service if either is being changed, and `airspaceAuthorizationId`'s FK is re-checked by the `UPDATE` itself).
  - `listIntersectingFlightPlans(bbox, altitudeFt?, activeAt?)` — two queries unioned (or run separately and concatenated in TS, whichever reads more clearly at the repository layer): polygon-typed plans via `intersectsEnvelope(polygon_area, ...)`, optionally `polygon_max_altitude_ft >= altitudeFt`; waypoints-typed plans via an `EXISTS` subquery against `flight_plan_waypoints` testing `ST_Intersects(ST_Buffer(point, radius_meters), envelope)` (the buffer computed at query time, per the spec — not pre-materialized), optionally `altitudeFt BETWEEN altitude_min_ft (exclusive) AND altitude_max_ft (inclusive)` on that same waypoint row.
- `src/routes/flight-plans.ts`, mounted at `/api/v1/flight-plans`:
  - `POST /` — `201`, `422` (`ownerId`/`pilotId`/`registrationId` not found, or registration/owner mismatch), `404` (`airspaceAuthorizationId` given but doesn't exist), `503`, or `409` (duplicate `flightPlanId`).
  - `GET /` — `200`, list with the five optional filters.
  - `GET /{flightPlanId}` — `200` (including `waypoints` if any) or `404`.
  - `PATCH /{flightPlanId}` — `200`, `404` (plan or referenced `airspaceAuthorizationId` not found), `422`, or `503`.
  - `GET /intersecting` — `200`, mounted before `/{flightPlanId}` for the same route-ordering reason as Phase 6's `covering`/`intersecting`.
- Verify: create a waypoints-shaped plan and a polygon-shaped plan; confirm the waypoints one's rows land atomically (kill/force a failure partway through in a unit test against the repository function, or at minimum confirm via code review that both inserts share one `tx`); confirm `422`s for a mismatched `registrationId`/`ownerId` pair; confirm `404` for a nonexistent `airspaceAuthorizationId`; confirm `intersecting` finds both a polygon plan and a waypoints plan whose cylinder overlaps the query box, and excludes ones that don't.

## Phase 8 — Waivers endpoints

Structurally closest to Phase 6 (same status lifecycle), but with the exactly-one-of-`pilotId`/`ownerId` shape instead of a required `ownerId` with optional narrowing, and no spatial component at all:

- `src/schemas/waiver.ts`: `WaiverIdParamSchema`; `WaiverTypeSchema` (`z.enum(['operations_from_moving_vehicle', 'night_operations', 'beyond_visual_line_of_sight', 'operations_over_people'])`); `CreateWaiverSchema` (`waiverId`, `waiverType`, `pilotId` nullable, `ownerId` nullable, `conditions`, `startTime`, `endTime`) with a `.refine()` enforcing exactly one of `pilotId`/`ownerId` is non-null (mirrors the table's `CHECK ((pilot_id IS NOT NULL) <> (owner_id IS NOT NULL))`) plus the usual `endTime > startTime` refine; `UpdateWaiverSchema` covering only `conditions`/`startTime`/`endTime`/`status`; `WaiverSchema` (response, includes `rescindedAt`); `ListWaiversQuerySchema` (`pilotId`/`ownerId`/`waiverType`/`activeAt`/`status`, all optional).
- `src/repositories/waivers.ts`:
  - `WaiverAlreadyExistsError`, `RescindedIsTerminalError` — same shape as Phase 6's authorization errors.
  - `OwnerNotFoundError`, `PilotNotFoundError` — `insertWaiver` calls `ownerExists` when `ownerId` is set, or `pilotExistsStandalone` (Phase 5's new standalone lookup — no `ownerId` is available here to nest under) when `pilotId` is set; exactly one of the two runs, per the refine above.
  - `insertWaiver`, `listWaivers(filter)`, `getWaiverById`, `updateWaiver` (`COALESCE`-based, `rescinded_at` stamped the same way as Phase 6 when `status` transitions to `'rescinded'`).
- `src/routes/waivers.ts`, mounted at `/api/v1/waivers`:
  - `POST /` — `201`, `422` (`pilotId`/`ownerId` not found), `503`, or `409` (duplicate `waiverId`).
  - `GET /` — `200`, list with the five optional filters.
  - `GET /{waiverId}` — `200` or `404`.
  - `PATCH /{waiverId}` — `200`, `404`, or `409` (`status` change attempted on an already-`'rescinded'` row).
- Verify: create a pilot-linked waiver and an owner-linked waiver; confirm `422` for both-set and neither-set `pilotId`/`ownerId` at the schema layer (`400`, since that's a Zod refine, not a repository check) as well as for a nonexistent id at the repository layer (`422`); confirm the `proposed → approved → rescinded` lifecycle and the terminal `409`, same as Phase 6.

## Phase 9 — Testing

- Unit tests (`Bun.test`) for: the `PolygonSchema`/`PointSchema` geometry schemas and the `Latitude`/`LongitudeSchema` range checks; the `CreateFlightPlanSchema` discriminated union (waypoints branch rejects `polygonArea`, polygon branch rejects `waypoints`, both reject `endTime <= startTime`); the `CreateWaiverSchema` exactly-one-of-`pilotId`/`ownerId` refine; `drone-registrations-client.ts`'s status-code branching with a mocked `fetch` (Phase 5).
- `src/test-support/reset-db.ts`: drops/recreates the `flight_authorizations` schema and re-runs migrations — same pattern as the sibling services.
- `src/integration.test.ts`: needs a running Drone Registrations Service instance to validate against (start it via its own `bun run src/index.ts` against the same dev/test Postgres instance, seeded with a couple of owners/pilots/registrations in `beforeAll`, same way `flight_authorizations_service` itself will be run in production) — covers: creating an authorization/flight plan/waiver against a known-good `ownerId`/`pilotId`/`registrationId` succeeds; each against an unknown one `422`s; the full `proposed → approved → rescinded` lifecycle and terminal `409` for both authorizations and waivers; `covering`/`intersecting` spatial matches and misses; a waypoints-shaped and a polygon-shaped flight plan round-trip correctly including `GET .../intersecting`; every duplicate-ID case `409`s; plus the Content-Type-guard and validation-error-shape cases every sibling integration suite covers.
- `bun test` as the `test` script.

## Phase 10 — Docker packaging

Following the pattern in `weather_service/dockerfile` / `build-docker.sh`:

- `flight_authorizations_service/dockerfile`: multi-stage, `FROM oven/bun:1.3.14-debian AS builder` → `bun install` → `bun build --compile --outfile server ./src/index.ts`, then a `debian:bookworm-slim` runtime stage copying just the compiled binary. `EXPOSE 8002` (this service's port).
- `flight_authorizations_service/build-docker.sh`: copy of a sibling's script with `IMAGE_NAME="utmimic-flight-authorizations-service"`.
- `.dockerignore`/`.gitignore` excluding `.env`, `node_modules`, build artifacts — copy from a sibling service.
- Verify (build-only, no push, matching the `weather_service`/`drone_registrations_service` Phase 9 convention): `bun build --compile` succeeds and the resulting binary boots standalone; `docker build` succeeds; remove the local test image afterward.
- `run-docker.sh` stays deferred, per the spec, until there's a real deployment target for it.

## Phase 11 — Docs follow-up

- Update [`flight_authorizations_service.md`](/modules/flight_authorizations_service/) to match implementation reality: remove the "Preliminary — no tables exist yet" caveat and the "Preliminary route sketch" qualifier, firm up the Docker packaging section's Bun image version, and confirm the already-resolved Open Questions entries (Drone Registrations Service unreachable → `503`, field immutability/patchability per entity, duplicate-ID handling) still match what got built — remove or update those bullets accordingly.
- Add `{ label: 'Flight Authorizations Service', slug: 'plans/flight_authorizations_service_plan' }` to the "Implementation Plans" section of `documentation/astro.config.mjs`'s sidebar, alongside the existing entries.
