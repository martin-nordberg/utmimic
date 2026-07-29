# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

utmimic is an early-stage project for tinkering with drone flight software ideas and technologies. Most of the repository is currently scaffolding rather than implemented flight software:

- `database/` — a PostgreSQL container (TimescaleDB + PostGIS) with its `dockerfile`/`build-docker.sh`/`run-docker.sh` and an extension/schema bootstrap script, but no application tables yet. See `documentation/src/content/docs/modules/database.md`.
- `documentation/` — an Astro + Starlight documentation site (the only buildable application code in the repo today). It has its own `documentation/CLAUDE.md` and `documentation/AGENTS.md` (identical content) — read those when working inside that directory, since they take precedence for that subtree.
- `sensor_flight_log_service/` — not yet created. A preliminary spec exists at `documentation/src/content/docs/modules/sensor_flight_log_service.md` for a planned Bun/Hono service that will own the `sensor_flight_log` database schema.
- `live_flight_log_service/` — not yet created. A preliminary spec exists at `documentation/src/content/docs/modules/live_flight_log_service.md` for a planned Bun/Hono service, nearly identical to `sensor_flight_log_service`, that will own the `live_flight_log` database schema (simulated ground-truth drone positions, as opposed to the sensor service's coarser, imprecise "observed" positions).
- `sensor_array_simulator/` — not yet created. A preliminary spec exists at `documentation/src/content/docs/modules/sensor_array_simulator.md` for a planned Go CLI that reads ground-truth positions from `live_flight_log_service` and writes simulated, imprecise sensor observations to `sensor_flight_log_service`. It owns no database schema of its own.
- `weather_service/` — not yet created. A preliminary spec exists at `documentation/src/content/docs/modules/weather_service.md` for a planned Bun/Hono service, same shape as the flight-log services, that will own the `weather` database schema (moving visibility and wind polygons). Its data producer (a weather simulator) isn't designed yet.
- `drone_registrations_service/` — not yet created. A preliminary spec exists at `documentation/src/content/docs/modules/drone_registrations_service.md` for a planned Bun/Hono service, same stack as the other services, that will own the `drone_registrations` database schema (owners, their pilots, and drone registration records). Ordinary relational CRUD data, not a time series — no TimescaleDB/PostGIS use here.
- `flight_authorizations_service/` — not yet created. A preliminary spec exists at `documentation/src/content/docs/modules/flight_authorizations_service.md` for a planned Bun/Hono service, same stack, that will own the `flight_authorizations` database schema (airspace authorizations and flight plans). Uses PostGIS geometry like the weather service; owner/pilot/registration IDs from `drone_registrations_service` are stored as plain columns (not real foreign keys, since it's a different service's schema) but validated synchronously against that service's API at write time.
- `flight_area_dashboard_web_server/` — not yet created, no spec doc yet. So far it only appears as a box in the architecture diagram (`documentation/_diagrams/utmimic-architecture.drawio`). Assigned port `8081` (see [Port assignments](#port-assignments)).
- `flight_area_dashboard_web_client/` — not yet created, no spec doc yet. So far it only appears as a box in the architecture diagram. Assigned port `8080` (see [Port assignments](#port-assignments)).

Because most modules haven't been built out yet, do not assume architecture, modules, or conventions beyond what is described here — confirm with the user before making structural decisions.

## Port assignments

| Module | Port |
| --- | --- |
| Weather Service | `8000` |
| Drone Registrations Service | `8001` |
| Flight Authorizations Service | `8002` |
| Live Flight Log Service | `8003` |
| Sensor Flight Log Service | `8004` |
| Flight Area Dashboard Web Client | `8080` |
| Flight Area Dashboard Web Server | `8081` |

Other modules (so far) are CLI-only (`sensor_array_simulator/`) or have their own established ports documented in their own module doc (`database/` on `5432`, plus a second dev/test Postgres instance on `5431` for integration testing — see [Development and test instance](/modules/database/#development-and-test-instance); `documentation/` served over HTTPS `443` in its container — see their respective docs under `documentation/src/content/docs/modules/`).

## Working in `documentation/`

The docs site is a standard Starlight starter. Run commands from `documentation/` (it uses `bun`):

| Command | Action |
| --- | --- |
| `bun install` | Install dependencies |
| `bun dev` | Start local dev server at `localhost:4321` |
| `bun build` | Build production site to `documentation/dist/` |
| `bun preview` | Preview a production build locally |
| `bun astro ...` | Run Astro CLI commands (e.g. `astro add`, `astro check`) |

When starting the dev server, run it in background mode (`astro dev --background`) and manage it with `astro dev stop` / `astro dev status` / `astro dev logs`, per `documentation/CLAUDE.md`.

Docs content lives under `documentation/src/content/docs/` as `.md`/`.mdx` files, routed by file path; the sidebar is configured explicitly in `documentation/astro.config.mjs`. There's currently an "Architecture" section (`architecture/overview.md`, which points at an architecture diagram exported from `documentation/_diagrams/utmimic-architecture.drawio`) and an auto-generated "Reference" section.

Full Starlight/Astro docs: https://docs.astro.build

## Code comment style

Every top-level declaration in application code — exported or not: functions, classes, types, interfaces, and consts — gets a one- or two-line JSDoc summary directly above it. See `sensor_flight_log_service/src/` for examples.

Longer explanations of non-obvious behavior ("why", not "what") stay as plain `//` comments; they aren't constrained to one or two lines. Put these inline inside the relevant code body — right above the line(s) they explain — whenever practical, rather than stacked above the declaration alongside the JSDoc. See `sensor_flight_log_service/src/app.ts`'s Content-Type check or `sensor_flight_log_service/src/openapi-router.ts` for the pattern. When there's no code body to put it in (e.g. a plain top-level const with no surrounding function), it's fine for the `//` comment to sit above the declaration, ahead of the JSDoc.

This applies to the actual codebase (`sensor_flight_log_service/` and future service modules) — not to `documentation/`'s Markdown/MDX content.

## Docker / container images

The project is expected to grow into multiple modules, each with its own tech stack and its own container image (`documentation/` and `database/` are the current examples). Conventions for every module:

- **Per-module files**: each module directory gets its own `dockerfile` and `build-docker.sh`, following the pattern in `documentation/dockerfile` and `documentation/build-docker.sh` — a multi-stage build (build stage in the appropriate toolchain image, slim runtime stage for serving/running) and a small build script that builds and pushes to the registry. `database/dockerfile` is an exception: since its base image already ships the needed toolchain, it skips the multi-stage build. Don't introduce a shared/root build script — copy and adapt the per-module pattern instead.
- **Registry**: images are built and pushed to the local network registry `mnserver.internal:5000`. It's a plain HTTP (insecure) registry that's already configured as trusted on the Docker daemons that need it — don't add insecure-registry setup steps or assume TLS.
- **Image naming**: `mnserver.internal:5000/utmimic-<module-name>:latest` (e.g. `utmimic-documentation`), matching the existing script's `REGISTRY`/`IMAGE_NAME`/`IMAGE_TAG` variables.
- **Tagging**: `latest` only for now — no git-SHA or semver tagging scheme yet.
- **No local `docker run`**: local development happens in WSL2, where Docker is only used to build and push images — never to run containers locally. Use each module's native dev workflow (e.g. `bun dev` for the docs site) for local testing/iteration. Docker builds are a deployment step: images get pushed to the registry and then pulled/run on a separate Kubuntu server. Don't suggest or run `docker run` as a way to test changes in this environment.
