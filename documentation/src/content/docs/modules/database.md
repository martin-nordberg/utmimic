---
title: Modules - Database
description: The PostgreSQL database for UTMimic
---

The database module is PostgreSQL with PostGIS and TimescaleDB running in a Docker container.

## Base image

The container is built from [`timescale/timescaledb-ha`](https://github.com/timescale/timescaledb-docker-ha), Timescale's high-availability image. It bundles TimescaleDB and PostGIS on top of PostgreSQL in a single image, so no manual extension compilation is required.

- **PostgreSQL version:** 17
- **Image tag:** `timescale/timescaledb-ha:pg17` (an unpinned major-version tag for now; pin to a specific `pg17.x-tsY.Y` tag once the deployment stabilizes)

Following the module convention in the root `CLAUDE.md`, this module gets its own `database/dockerfile` and `database/build-docker.sh`, pushing to `mnserver.internal:5000/utmimic-database:latest`. Since the base image already ships Postgres/TimescaleDB/PostGIS, `database/dockerfile` doesn't need a multi-stage build — it starts `FROM timescale/timescaledb-ha:pg17` and only adds the extension bootstrap script described below.

Deployment onto the Kubuntu server is a separate `database/run-docker.sh` script, run there rather than in local dev. It pulls the pushed image, ensures the persistent volume exists, replaces any existing container of the same name (data lives in the volume, not the container), and starts the new one with `--restart unless-stopped`.

## Data persistence

Data persists in a named Docker volume, `utmimic-database-data`, mounted into the container.

The image expects `PGDATA` to point at a subdirectory of the mount (Patroni, which manages the image's HA tooling, occasionally needs to relocate an invalid data directory next to the live one), so the container is run with:

```
-v utmimic-database-data:/pgdata
-e PGDATA=/pgdata/data
```

The image hardcodes the `postgres` user as UID/GID `1000:1000`; Docker-managed named volumes handle this automatically, so no manual `chown` step is needed.

## Configuration and credentials

Credentials are supplied via plain environment variables (`POSTGRES_PASSWORD`, and `POSTGRES_USER`/`POSTGRES_DB` if a non-default user or database is needed), passed at `docker run` time or via an env file kept out of version control. `database/run-docker.sh` looks for a `database/.env` file (gitignored) alongside itself and sources it if present, so credentials never need to be typed on the command line on the server. This is sufficient for the project's current early stage; revisit if/when the deployment needs tighter secret handling (e.g. Docker secrets).

## Networking

The container publishes PostgreSQL's default port, `5432`, on the Kubuntu deployment host. Other UTMimic modules connect to it as `<host>:5432` rather than over a Docker-internal network, since not every module is guaranteed to be containerized on the same host/network.

## Extensions

No tables exist yet, so the only initialization step is enabling the two extensions on first startup:

```sql
CREATE EXTENSION IF NOT EXISTS timescaledb;
CREATE EXTENSION IF NOT EXISTS postgis;
```

This is run once via a script dropped into the image's `/docker-entrypoint-initdb.d/` directory (added by `database/dockerfile`), which Postgres executes automatically the first time the data directory is initialized. The schema creation below runs from the same script.

## Schemas

Three independent schemas are planned, one per functional area:

| Schema | Purpose |
| --- | --- |
| `sensor_flight_data` | Sensor Flight Data |
| `live_flight_data` | Live Flight Data |
| `flight_authorizations` | Flight Authorizations |

```sql
CREATE SCHEMA IF NOT EXISTS sensor_flight_data;
CREATE SCHEMA IF NOT EXISTS live_flight_data;
CREATE SCHEMA IF NOT EXISTS flight_authorizations;
```

No tables exist within them yet — table design is deferred to [Migrations](#migrations) below.

## Migrations

TODO: no tables exist yet, so a migration tool hasn't been chosen. Candidates to evaluate once an application/schema materializes:

- **Flyway** — plain versioned `.sql` migration files, language-agnostic CLI.
- **golang-migrate** — lightweight CLI, plain SQL up/down files, language-agnostic.
- **Sqitch** — git-like dependency-based SQL migrations, Postgres-native.

The choice may also be influenced by whatever application framework eventually consumes this database (e.g. an ORM's built-in migration tool), which doesn't exist yet either.

## Backups

Not addressed yet — a future concern once the database holds data worth protecting.