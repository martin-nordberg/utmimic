---
title: Modules - Flight Authorizations Service
description: Web service to read and write flight plans and airspace authorizations
---

This module is a stand-alone web service that wraps the PostgreSQL `flight_authorizations` schema (see [Database](/modules/database/)).

Two key entities:

- **Airspace authorizations** — a polygonal area, a maximum altitude, a start/end time, the owner ID authorized, and optionally the pilot ID authorized (both from [Drone Registrations Service](/modules/drone_registrations_service/)).
- **Flight plans** — either a sequence of lat/long/altitude/radius waypoints, or a single polygonal area and altitude. A flight plan is linked to an owner, optionally a specific registration, and optionally a specific pilot (again, all IDs from Drone Registrations Service), has a start/end time, and may optionally be linked to one airspace authorization.

This service only stores and serves these two record types — it does not itself decide whether a flight plan is actually authorized (i.e. does it fit inside its linked authorization, or any authorization at all), and it does not check whether authorizations or flight plans overlap each other in space/time. That kind of automated decision-making belongs to a separate module (the architecture overview's "Authorization Auto Coordination," not designed yet), which is expected to use the spatial query endpoints below (`covering`, `intersecting`) to do it.

It is the sole owner of the `flight_authorizations` schema: no other module reads or writes those tables directly, and this service also owns the schema's migrations (see [Migrations](#migrations)).

## Technologies

Same stack as the other Bun/Hono services in this project ([Sensor Flight Log Service](/modules/sensor_flight_log_service/), [Live Flight Log Service](/modules/live_flight_log_service/), [Weather Service](/modules/weather_service/), [Drone Registrations Service](/modules/drone_registrations_service/)):

* **Bun** as JavaScript engine and runtime
* **Hono** as web service routing and middleware framework
* **Zod** for data validation, including the same hand-written GeoJSON `Polygon` schema used by [Weather Service](/modules/weather_service/#technologies)
* **@hono/zod-openapi** for request/response validation against Zod schemas plus OpenAPI generation from the same definitions
* **@paralleldrive/cuid2** for any unique IDs that need generation; clients generate IDs themselves where feasible (e.g. `authorizationId`, `flightPlanId` — see [API](#api))
* **Bun.sql** for PostgreSQL access, including PostGIS functions (`ST_GeomFromGeoJSON`, `ST_AsGeoJSON`, `ST_Contains`, `ST_Buffer`) — no ORM/spatial library needed for this
* Bun's built-in `fetch` to call [Drone Registrations Service](/modules/drone_registrations_service/) for cross-service ID validation — no separate HTTP client library needed
* **Pino** for structured (JSON) logging to stdout
* Packaged in a Docker container running a Bun native executable (`bun build --compile`)
* **Bun.test** for unit testing
* Hand-rolled migration runner, written in TypeScript, living inside this module (see [Migrations](#migrations))

Like [Drone Registrations Service](/modules/drone_registrations_service/#data-model), this is episodic record data, not a constant report stream — no TimescaleDB hypertables. Like [Weather Service](/modules/weather_service/#data-model), it does need PostGIS `geometry` columns, since spatial containment (is this flight plan inside this authorization?) is the whole point.

## Data model

Preliminary — no tables exist yet in `flight_authorizations`; this is a starting design, not a final one.

**Cross-service references**: `ownerId`, `registrationId`, and `pilotId` throughout this schema refer to rows in [Drone Registrations Service](/modules/drone_registrations_service/)'s `drone_registrations` schema — a *different* service's schema. Per this project's convention (each service is the sole owner of its own schema), there are no real foreign keys across that boundary; these are plain `text` columns. Unlike a same-schema FK, though, they **are** validated — at write time, this service calls Drone Registrations Service synchronously (see [API](#api)) rather than trusting the caller. That validation only happens at write time, not continuously: if Drone Registrations Service later changes or removes something this service already accepted an ID for, nothing here notices. See [Open questions](#open-questions).

### `airspace_authorizations`

| Column | Type | Notes |
| --- | --- | --- |
| `authorization_id` | `text` | Client-generated cuid2 |
| `area` | `geometry(Polygon, 4326)` | The authorized area |
| `max_altitude_ft` | `double precision` | `0`–`2000`, enforced by a check constraint |
| `start_time` | `timestamptz` | |
| `end_time` | `timestamptz` | |
| `owner_id` | `text` | Cross-service reference (see above); the owner authorized |
| `pilot_id` | `text` | Cross-service reference; nullable — the specific pilot authorized, if narrowed to one |
| `status` | `text` | `'proposed'`, `'approved'`, or `'rescinded'`; `default 'proposed'` |
| `rescinded_at` | `timestamptz` | Set only when `status = 'rescinded'`, enforced by a check constraint |
| `created_at` | `timestamptz` | `default now()` |
| `updated_at` | `timestamptz` | `default now()`, bumped on every update |

```sql
CREATE TABLE flight_authorizations.airspace_authorizations (
    authorization_id text PRIMARY KEY,
    area             geometry(Polygon, 4326) NOT NULL,
    max_altitude_ft  double precision NOT NULL,
    start_time       timestamptz NOT NULL,
    end_time         timestamptz NOT NULL,
    owner_id         text NOT NULL,
    pilot_id         text,
    status           text NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed', 'approved', 'rescinded')),
    rescinded_at     timestamptz,
    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now(),
    CHECK (end_time > start_time),
    CHECK ((status = 'rescinded') = (rescinded_at IS NOT NULL)),
    CHECK (max_altitude_ft >= 0 AND max_altitude_ft <= 2000)
);

CREATE INDEX ON flight_authorizations.airspace_authorizations (owner_id);
CREATE INDEX ON flight_authorizations.airspace_authorizations USING GIST (area);
```

`rescinded_at` is set by the service itself (to `now()`) the moment `status` transitions to `'rescinded'` via `PATCH` — it's not a client-supplied field (see [API](#api)). `'rescinded'` is terminal: once set, the service rejects any further `status` change on that row. This isn't expressible as a plain `CHECK` constraint (which only ever sees the new row, not the one it's replacing) — it's enforced in the service's update handler, not the schema.

### `flight_plans`

A flight plan is shaped one of two ways, discriminated by `plan_type` — mutually exclusive with the `flight_plan_waypoints` table below, same reasoning as [Weather Service](/modules/weather_service/#data-model)'s observed/forecast split (distinct shapes get distinct storage rather than one table full of columns that only apply half the time):

| Column | Type | Notes |
| --- | --- | --- |
| `flight_plan_id` | `text` | Client-generated cuid2 |
| `plan_type` | `text` | `'waypoints'` or `'polygon'` |
| `owner_id` | `text` | Cross-service reference; required |
| `registration_id` | `text` | Cross-service reference; nullable |
| `pilot_id` | `text` | Cross-service reference; nullable |
| `airspace_authorization_id` | `text` | References `airspace_authorizations.authorization_id` (same schema, real FK); nullable |
| `start_time` | `timestamptz` | |
| `end_time` | `timestamptz` | |
| `polygon_area` | `geometry(Polygon, 4326)` | Set only when `plan_type = 'polygon'` |
| `polygon_max_altitude_ft` | `double precision` | Set only when `plan_type = 'polygon'`; ceiling, **inclusive**, floor implicitly ground (0 ft) — same convention as `airspace_authorizations.max_altitude_ft`. `0`–`2000` when set, enforced by a check constraint |
| `created_at` | `timestamptz` | `default now()` |
| `updated_at` | `timestamptz` | `default now()`, bumped on every update |

```sql
CREATE TABLE flight_authorizations.flight_plans (
    flight_plan_id             text PRIMARY KEY,
    plan_type                  text NOT NULL CHECK (plan_type IN ('waypoints', 'polygon')),
    owner_id                   text NOT NULL,
    registration_id            text,
    pilot_id                   text,
    airspace_authorization_id  text REFERENCES flight_authorizations.airspace_authorizations (authorization_id),
    start_time                 timestamptz NOT NULL,
    end_time                   timestamptz NOT NULL,
    polygon_area               geometry(Polygon, 4326),
    polygon_max_altitude_ft    double precision,
    created_at                 timestamptz NOT NULL DEFAULT now(),
    updated_at                 timestamptz NOT NULL DEFAULT now(),
    CHECK (end_time > start_time),
    CHECK ((plan_type = 'polygon') = (polygon_area IS NOT NULL)),
    CHECK ((plan_type = 'polygon') = (polygon_max_altitude_ft IS NOT NULL)),
    CHECK (polygon_max_altitude_ft IS NULL OR (polygon_max_altitude_ft >= 0 AND polygon_max_altitude_ft <= 2000))
);

CREATE INDEX ON flight_authorizations.flight_plans (owner_id);
CREATE INDEX ON flight_authorizations.flight_plans (registration_id);
CREATE INDEX ON flight_authorizations.flight_plans (airspace_authorization_id);
CREATE INDEX ON flight_authorizations.flight_plans USING GIST (polygon_area);
```

### `flight_plan_waypoints`

One row per waypoint, only populated when the owning flight plan's `plan_type = 'waypoints'` (not enforced at the DB level, same caveat as the cross-service ID columns above):

| Column | Type | Notes |
| --- | --- | --- |
| `flight_plan_id` | `text` | References `flight_plans.flight_plan_id` |
| `sequence_number` | `integer` | Order along the path, starting at 0 or 1 |
| `point` | `geometry(Point, 4326)` | |
| `altitude_min_ft` | `double precision` | **Exclusive** lower bound; `0`–`2000`, enforced by a check constraint |
| `altitude_max_ft` | `double precision` | **Inclusive** upper bound; `0`–`2000` and `> altitude_min_ft`, enforced by a check constraint |
| `radius_meters` | `double precision` | Defines a cylinder of allowed airspace around `point`, spanning `(altitude_min_ft, altitude_max_ft]` |

```sql
CREATE TABLE flight_authorizations.flight_plan_waypoints (
    flight_plan_id   text NOT NULL REFERENCES flight_authorizations.flight_plans (flight_plan_id),
    sequence_number  integer NOT NULL,
    point            geometry(Point, 4326) NOT NULL,
    altitude_min_ft  double precision NOT NULL,
    altitude_max_ft  double precision NOT NULL,
    radius_meters    double precision NOT NULL,
    PRIMARY KEY (flight_plan_id, sequence_number),
    CHECK (altitude_min_ft >= 0 AND altitude_max_ft <= 2000 AND altitude_min_ft < altitude_max_ft)
);

CREATE INDEX ON flight_authorizations.flight_plan_waypoints USING GIST (point);
```

Notes:

- No TimescaleDB hypertables anywhere in this schema — see [Technologies](#technologies).
- `flight_plans.polygon_area` and `flight_plan_waypoints.point` use PostGIS `geometry(..., 4326)`, same rationale as [Weather Service](/modules/weather_service/#data-model): spatial containment against `airspace_authorizations.area` is the actual point of this data.
- A waypoint's `radius_meters` isn't pre-materialized as a buffered polygon; a "does this waypoint's cylinder fit inside this authorization" check would compute `ST_Buffer(point, radius)` (in an appropriate projected SRID) at query time rather than storing it.
- Nothing in this service checks that a flight plan actually fits within its linked (or any) `airspace_authorization` — see the note at the top of this page.

## API

Preliminary route sketch, mounted under `/api/v1`:

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/airspace-authorizations` | Create an authorization |
| `GET` | `/airspace-authorizations` | List authorizations, optionally filtered by `ownerId`, `pilotId`, `activeAt`, `status` |
| `GET` | `/airspace-authorizations/{authorizationId}` | Get one authorization |
| `PATCH` | `/airspace-authorizations/{authorizationId}` | Update an authorization's fields, including `status` transitions |
| `GET` | `/airspace-authorizations/covering` | Authorization(s) covering a given point and time, optionally filtered by altitude and/or `status` |
| `GET` | `/airspace-authorizations/intersecting` | Authorization(s) whose area intersects a given lat/lon bounding box, optionally filtered by altitude, time, and/or `status` |
| `POST` | `/flight-plans` | Create a flight plan (waypoints or polygon shape) |
| `GET` | `/flight-plans` | List flight plans, optionally filtered by `ownerId`, `registrationId`, `pilotId`, `airspaceAuthorizationId`, `activeAt` |
| `GET` | `/flight-plans/{flightPlanId}` | Get one flight plan (including its waypoints, if any) |
| `PATCH` | `/flight-plans/{flightPlanId}` | Update a flight plan's fields (including linking/unlinking an `airspaceAuthorizationId`) |
| `GET` | `/flight-plans/intersecting` | Flight plan(s) whose shape (polygon, or any waypoint's cylinder) intersects a given lat/lon bounding box, optionally filtered by altitude and/or time |
| `GET` | `/healthz` | Liveness/readiness check for container orchestration |

`POST /airspace-authorizations`:

```json
{
  "authorizationId": "clh6z8h1x0000qzrm...",
  "area": {
    "type": "Polygon",
    "coordinates": [[
      [-122.42, 47.61], [-122.40, 47.61], [-122.40, 47.63], [-122.42, 47.63], [-122.42, 47.61]
    ]]
  },
  "maxAltitudeFt": 400,
  "startTime": "2026-08-01T14:00:00.000Z",
  "endTime": "2026-08-01T18:00:00.000Z",
  "ownerId": "clh6owner0000qzrm...",
  "pilotId": null
}
```

A new authorization always starts `status: "proposed"` (not settable at creation); `PATCH .../{authorizationId}` with `{"status": "approved"}` or `{"status": "rescinded"}` transitions it — a transition to `"rescinded"` stamps `rescindedAt` server-side. `"rescinded"` is final: a `PATCH` attempting to change `status` away from `"rescinded"` is rejected (`409`). Whether `"approved"` can revert to `"proposed"` isn't decided — see [Open questions](#open-questions).

`GET /airspace-authorizations/covering?lat={lat}&lon={lon}&at={timestamp}` returns any authorization(s), *of any status*, whose area contains the point, and whose `[startTime, endTime]` covers `at` (default now). `altitudeFt` and `status` are both optional: omit `altitudeFt` to match regardless of `maxAltitudeFt`, or pass it to require `maxAltitudeFt >= altitudeFt`; omit `status` to match any status, or pass `status=approved` (or `proposed`/`rescinded`) to narrow to just one — e.g. a consumer that only cares about actually-in-force authorizations would call it with `status=approved` rather than relying on a default, since covering by itself says nothing about whether the match is actually authorized.

`GET /airspace-authorizations` accepts the same `status` filter, on top of its existing `ownerId`/`pilotId`/`activeAt` filters.

`GET /airspace-authorizations/intersecting?minLat={..}&minLon={..}&maxLat={..}&maxLon={..}&altitudeFt={..}&at={..}&status={..}` is `covering`'s sibling for a rectangular area instead of a single point: it returns any authorization whose `area` intersects the given lat/lon bounding box (`ST_Intersects` against an `ST_MakeEnvelope` built from the four corners, using the existing `USING GIST (area)` index). `altitudeFt`, `at`, and `status` are optional with the same semantics as `covering`.

`GET /flight-plans/intersecting?minLat={..}&minLon={..}&maxLat={..}&maxLon={..}&altitudeFt={..}&activeAt={..}` finds flight plans whose shape intersects the bounding box — handled differently per `planType`, since only one of them has a single polygon to test:

- `'polygon'` plans: `ST_Intersects(polygon_area, envelope)`, optionally also requiring `polygonMaxAltitudeFt >= altitudeFt` when `altitudeFt` is given (floor is implicitly ground).
- `'waypoints'` plans: intersects if *any* of the plan's waypoints has `ST_Intersects(ST_Buffer(point, radius_meters), envelope)`, optionally also requiring `altitudeFt` to fall within that waypoint's `(altitudeMinFt, altitudeMaxFt]` band.

`altitudeFt` and `activeAt` are both optional, same "omit to not filter on it" convention as the other spatial endpoints. There's no `status` parameter here — flight plans don't have a `status` field (see [Data model](#data-model)).

`POST /flight-plans`, waypoints variant:

```json
{
  "flightPlanId": "clh6plan0000qzrm...",
  "planType": "waypoints",
  "ownerId": "clh6owner0000qzrm...",
  "registrationId": "clh6reg00000qzrm...",
  "pilotId": null,
  "airspaceAuthorizationId": "clh6z8h1x0000qzrm...",
  "startTime": "2026-08-01T14:30:00.000Z",
  "endTime": "2026-08-01T15:30:00.000Z",
  "waypoints": [
    { "latitude": 47.615, "longitude": -122.415, "altitudeMinFt": 250, "altitudeMaxFt": 350, "radiusMeters": 50 },
    { "latitude": 47.620, "longitude": -122.405, "altitudeMinFt": 300, "altitudeMaxFt": 400, "radiusMeters": 50 }
  ]
}
```

`POST /flight-plans`, polygon variant (`waypoints` replaced by `polygonArea`/`polygonMaxAltitudeFt`, `planType: "polygon"`):

```json
{
  "flightPlanId": "clh6plan0001qzrm...",
  "planType": "polygon",
  "ownerId": "clh6owner0000qzrm...",
  "registrationId": null,
  "pilotId": null,
  "airspaceAuthorizationId": null,
  "startTime": "2026-08-01T16:00:00.000Z",
  "endTime": "2026-08-01T17:00:00.000Z",
  "polygonArea": {
    "type": "Polygon",
    "coordinates": [[
      [-122.41, 47.61], [-122.40, 47.61], [-122.40, 47.62], [-122.41, 47.62], [-122.41, 47.61]
    ]]
  },
  "polygonMaxAltitudeFt": 250
}
```

All request/response shapes are Zod schemas, and `@hono/zod-openapi` derives the OpenAPI document from them, served at `/openapi.json` with Swagger UI at `/docs` for manual exploration.

**Cross-service ID validation**: on every `POST`/`PATCH` that sets `ownerId`, `registrationId`, or `pilotId`, this service calls [Drone Registrations Service](/modules/drone_registrations_service/) (`DRONE_REGISTRATIONS_SERVICE_URL`, see [Configuration](#configuration)) before writing:

- `ownerId` — `GET /owners/{ownerId}`; `422` if not found.
- `pilotId` (when given) — `GET /owners/{ownerId}/pilots/{pilotId}`, i.e. looked up *under* the given owner, not standalone; `422` if not found (covers both "pilot doesn't exist" and "pilot belongs to a different owner" in one check).
- `registrationId` (when given) — `GET /drone-registrations/{registrationId}`; `422` if not found, and also `422` if its `ownerId` doesn't match the given `ownerId`.

## Migrations

Migrations are TypeScript files owned by this module, not a separate CLI tool — same rationale and mechanism as the other services (see [Sensor Flight Log Service](/modules/sensor_flight_log_service/#migrations)).

- Migration files live in `migrations/`, named `0001_create_airspace_authorizations.ts`, `0002_create_flight_plans.ts`, `0003_create_flight_plan_waypoints.ts` (this order, since `flight_plans` references `airspace_authorizations` and `flight_plan_waypoints` references `flight_plans`), each exporting `up(sql)` and `down(sql)` functions that run statements via `Bun.sql`.
- A `flight_authorizations.schema_migrations` table tracks which migration filenames have been applied and when.
- A small runner script (`bun run migrate`) reads `migrations/` in order, compares against `schema_migrations`, and applies any pending ones inside a transaction.
- The container runs migrations on startup, before the HTTP server begins listening — acceptable for a single-instance early-stage deployment; revisit (e.g. a separate migrate step/job) if this ever runs with multiple replicas.

## Logging

Pino writes structured (JSON) logs to stdout, one line per log event, ready to be picked up by a future log aggregator without reformatting. `LOG_LEVEL` (see [Configuration](#configuration)) controls verbosity.

## Configuration

Supplied via environment variables:

| Variable | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | yes | Postgres connection string, e.g. `postgres://user:pass@<host>:5432/<db>` pointing at the [Database](/modules/database/) module |
| `PORT` | no | HTTP listen port for the service, default `8002` |
| `LOG_LEVEL` | no | Pino log level, e.g. `info`, `debug` |
| `DRONE_REGISTRATIONS_SERVICE_URL` | yes | Base URL of [Drone Registrations Service](/modules/drone_registrations_service/), used for cross-service ID validation |

As with the other services, secrets are kept out of version control and supplied via environment or a gitignored `.env` file sourced by a future `run-docker.sh`.

## Docker packaging

Following the module convention in the root `CLAUDE.md`, this module gets its own `flight_authorizations_service/dockerfile` and `flight_authorizations_service/build-docker.sh`, pushing to `mnserver.internal:5000/utmimic-flight-authorizations-service:latest`.

Multi-stage build, mirroring the pattern in `documentation/dockerfile`:

1. **Build stage** — `FROM oven/bun:<version>-debian`, `bun install`, then `bun build --compile --outfile server ./src/index.ts` to produce a standalone native executable.
2. **Runtime stage** — a slim base image containing just the compiled binary, running it directly (no Bun runtime needed at runtime since the executable is self-contained).

A `run-docker.sh` for the Kubuntu deployment host, analogous to `database/run-docker.sh`, is deferred until the service has something to deploy.

## Testing

Unit tests use `Bun.test`. Integration tests run against the shared dev/test Postgres instance described in [Database](/modules/database/#development-and-test-instance) (port `5431` on the Kubuntu server) rather than mocks, matching the project's general preference for testing against real dependencies. Test setup drops and re-runs this service's own migrations against its schema at the start of a run, rather than a separate wipe mechanism.

## Open questions

- **Runtime dependency on Drone Registrations Service**: validating `ownerId`/`registrationId`/`pilotId` synchronously (see [API](#api)) means this service can no longer accept writes if Drone Registrations Service is unreachable. Whether that should be a hard failure (`503`) or some kind of degraded/best-effort fallback isn't decided.
- Validation happens once, at write time — if Drone Registrations Service later changes or removes an owner/pilot/registration this service already validated, nothing here re-checks or gets notified.
- Whether `"approved"` can revert to `"proposed"` (`"rescinded"` itself is decided: terminal, no way out — see [Data model](#data-model)).
- Whether a flight plan should be allowed to exist with no `airspaceAuthorizationId` at all (e.g. representing a pending/unauthorized plan) — current design allows it, since the field is explicitly optional, but the implications (can it ever "fly" without one?) are Authorization Auto Coordination's concern, not this service's.
- `flight_plan_waypoints.radius_meters` has no bounds check beyond `NOT NULL` (altitude fields across all three tables are now uniformly bound to `0`–`2000` ft).
- Authentication/authorization on all endpoints (currently unspecified).
- Retention/archival policy for old (past `endTime`) flight plans and authorizations.
