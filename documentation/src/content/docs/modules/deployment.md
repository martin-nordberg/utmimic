---
title: Modules - Deployment
description: Docker Compose deployment for the utmimic stack
---

The `deployment/` module brings up the whole utmimic stack — the shared
[database](/modules/database/) plus the web services — together via Docker
Compose, on the Kubuntu deployment server. It's an alternative to starting
modules one at a time with their own `run-docker.sh` scripts; both point at
the same `utmimic-database-data` volume, so switching between them doesn't
lose data.

Local development (WSL2) never runs containers directly — it only builds and
pushes images, per the root `CLAUDE.md`'s Docker conventions. `docker
compose up` here is a server-side deployment step, run from
`deployment/compose.yaml`.

## Image sourcing

`compose.yaml` only ever pulls pre-built images from the registry
(`mnserver.internal:5000/utmimic-*:latest`) — it has no `build:` stanzas.
Building and pushing stays each module's own `build-docker.sh`, unchanged;
`deployment/build-all.sh` just sequences all of them from WSL2 so the whole
stack's images can be rebuilt with one command, without duplicating any
module's build logic.

## Networking

Services reach each other over Compose's own internal bridge network
(`utmimic`) using service-name DNS — e.g. `flight_authorizations_service`
calls `http://drone_registrations_service:8001` rather than a host address.
This supersedes the [database module](/modules/database/)'s older
networking note that assumed modules might not share a host/network: now
that the whole stack is deployed together via this one Compose file, an
internal network is simpler. Each service still also publishes its assigned port (see the root
`CLAUDE.md`'s Port assignments table) to the host, and the database
publishes `5432`, for access from outside the Compose network (e.g. a
developer's local tooling).

## Configuration and credentials

Credentials are supplied via a `deployment/.env` file (gitignored), sourced
automatically by `deployment/up.sh` — same pattern as `database/.env`.
`POSTGRES_PASSWORD` is required; `POSTGRES_USER`, `POSTGRES_DB`, and
`LOG_LEVEL` are optional and default to `postgres`, `postgres`, and `info`.
Each service's `DATABASE_URL` is built from these same credentials inside
`compose.yaml`, pointed at the `database` service over the internal
network.

## Migrations

Each service applies its own database migrations automatically on startup
(before it starts listening), so no separate migration step exists in
Compose.

## Running

```bash
./up.sh    # pulls the latest images and (re)starts every container
./down.sh  # stops and removes containers; the database volume is untouched
```

## Adding a new service

Add a new block to `compose.yaml` following the pattern of the existing
five services: image from the registry, `DATABASE_URL` built from the
shared Postgres credentials, its assigned port, and a `depends_on: database
(service_healthy)`. `flight_area_dashboard_web_server`/`_web_client` and
`sensor_array_simulator` aren't included yet since those modules don't
exist.
