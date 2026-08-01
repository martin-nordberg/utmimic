# deployment

Runs the whole utmimic stack (the shared database plus the five web services)
together via Docker Compose, on the Kubuntu deployment server. This is an
alternative to starting modules one at a time with their own `run-docker.sh`
scripts — either approach works, and both point at the same
`utmimic-database-data` volume, so switching between them doesn't lose data.

Local development (WSL2) never runs containers directly; it only builds and
pushes images. `docker compose up` here is a server-side deployment step.

## Prerequisites

Every module's image must already be built and pushed to the registry
(`mnserver.internal:5000`). From WSL2:

```bash
./build-all.sh
```

This just sequences each module's own `build-docker.sh` — see
[Docker / container images](../CLAUDE.md) for the per-module convention.

## Configuration

Copy `.env.example` to `.env` and fill in `POSTGRES_PASSWORD` (required).
`POSTGRES_USER`, `POSTGRES_DB`, and `LOG_LEVEL` are optional and default to
`postgres`, `postgres`, and `info` respectively. `.env` is gitignored.

## Running

On the Kubuntu deployment server:

```bash
./up.sh    # pulls the latest images and (re)starts every container
./down.sh  # stops and removes containers; the database volume is untouched
```

Services reach each other over Compose's internal network by service name
(e.g. `flight_authorizations_service` calls
`http://drone_registrations_service:8001`). Each service also publishes its
assigned port (see the [Port assignments](../CLAUDE.md#port-assignments)
table) to the host, and the database publishes `5432`, for access from
outside the Compose network.

Each service applies its own database migrations automatically on startup,
so no separate migration step is needed here.

## Adding a new service

Add a new block to `compose.yaml` following the pattern of the existing
five: image from the registry, `DATABASE_URL` built from the shared
Postgres credentials, its assigned `PORT`, and a `depends_on: database
(service_healthy)`. `flight_area_dashboard_web_server/client` and
`sensor_array_simulator` aren't included yet since those modules don't
exist.
