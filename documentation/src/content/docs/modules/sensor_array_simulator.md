---
title: Modules - Sensor Array Simulator
description: Command-line tool simulating a network of independent sensors observing live flight positions
---

This module is a stand-alone command-line executable that simulates a network of geographically dispersed, independent
sensors capturing live flight data. Each simulated sensor observes drone positions within its own coverage radius, at
its own polling interval, and reports them with simulated latency and positional imprecision relative to the
ground-truth position.

This module reads ground-truth positions from [Live Flight Log Service](/modules/live_flight_log_service/) and writes
the simulated sensor observations to [Sensor Flight Log Service](/modules/sensor_flight_log_service/). It has no local
configuration of which sensors to simulate or how — that entirely lives in Sensor Flight Log Service's sensor registry
and per-sensor profiles, which this module discovers and reads (see [Sensor discovery](#sensor-discovery)). It owns no
database schema of its own — it is purely an HTTP client of those two services.

## Technologies

* Go CLI
* `net/http` (stdlib) for calling the two web services
* `log/slog` (stdlib) with a JSON handler for structured logging to stdout, paralleling the Pino JSON logging used by the other services
* Goroutines: one per simulated sensor for its simulation loop, plus one driving the discovery poll — all on their own `time.Ticker`, no scheduling/worker-pool library needed
* `encoding/json` (stdlib) for HTTP payload (de)serialization
* Go's built-in `testing` package for unit tests
* `os/signal` + `context` (stdlib) for graceful shutdown (see [Sensor discovery](#sensor-discovery))
* TBD: client-generated report ID scheme to parallel the other services' cuid2 idempotency keys — a Go cuid2 implementation, e.g. `github.com/nrednav/cuid2`, or a simpler stdlib-based random ID
* Packaged in a Docker container running a statically-linked Go binary

## Sensor discovery

There is no local sensor config file. Instead, on a recurring interval (`DISCOVERY_POLL_INTERVAL`, see [Configuration](#configuration)), this module:

1. `GET /sensors` on Sensor Flight Log Service to list all registered sensors.
2. `GET /sensors/{sensorId}/profile` for each one.

A sensor with a profile is treated as "this module should be actively simulating it." The profile holds exactly the simulation-tuning fields this module needs and nothing else — an arbitrary JSON document that Sensor Flight Log Service stores but doesn't interpret (see its [Data model](/modules/sensor_flight_log_service/#data-model)):

```json
{
  "pollIntervalMs": { "min": 2000, "max": 5000 },
  "latencyMs": { "min": 200, "max": 1500 },
  "positionErrorStdDev": { "metersHorizontal": 15, "feetVertical": 20 }
}
```

A sensor's identity and placement (`name`, `latitude`, `longitude`, `sensingRadiusMeters`) come from the sensor record itself (step 1) — this module never writes those fields, only reads them.

Each discovery pass reconciles the running simulation goroutines (see [Simulation loop](#simulation-loop)) against what was just fetched:

| Change observed | Action |
| --- | --- |
| Sensor + profile appear that weren't running before | Start a goroutine for it; `PATCH /sensors/{sensorId}` with `status: "online"` |
| A running sensor's profile changed | Restart its goroutine with the new tuning parameters |
| A running sensor's profile was removed, or the sensor no longer appears | Stop its goroutine; `PATCH /sensors/{sensorId}` with `status: "offline"` |

This module owns the `status` field for sensors it's actively simulating — flipping it as it starts/stops running them — even though it no longer owns their identity or profile. On graceful shutdown (`SIGINT`/`SIGTERM`), it best-effort `PATCH`es every currently-running sensor to `status: "offline"` before exiting. Since Sensor Flight Log Service's status is explicit-only (no heartbeat/staleness detection — see its own open questions), a crash of this simulator leaves its sensors showing `online` indefinitely until the next graceful stop or discovery cycle.

What actually creates a sensor and its profile in the first place (an operator via Sensor Flight Log Service's Swagger UI, a seed script, etc.) is outside this module's scope — see [Open questions](#open-questions).

## Simulation loop

Per actively-simulated sensor, running in its own goroutine:

1. Wait for the next tick, at a randomly chosen interval within `pollIntervalMs`.
2. Fetch candidate drones' current positions from Live Flight Log Service.
3. Filter to drones within `sensingRadiusMeters` of the sensor's location (great-circle distance, computed in-process — no PostGIS dependency needed for this simple radius check).
4. For each drone still in range, apply simulated imprecision: independent Gaussian noise on latitude/longitude (`metersHorizontal` std. dev., converted to degrees) and on altitude (`feetVertical` std. dev.).
5. Apply simulated latency: delay the write by a random duration within `latencyMs`, so the sensor's report lands in `sensor_flight_log` after `recordedAt` has already passed — mirroring real transmission/reception lag.
6. `POST` the resulting report to Sensor Flight Log Service, with a freshly generated `reportId` as an idempotency key and this sensor's `sensorId`.

## Configuration

Supplied via environment variables:

| Variable | Required | Purpose |
| --- | --- | --- |
| `LIVE_FLIGHT_LOG_URL` | yes | Base URL of [Live Flight Log Service](/modules/live_flight_log_service/) |
| `SENSOR_FLIGHT_LOG_URL` | yes | Base URL of [Sensor Flight Log Service](/modules/sensor_flight_log_service/) |
| `DISCOVERY_POLL_INTERVAL` | no | How often to re-run [sensor discovery](#sensor-discovery) (default TBD) |
| `LOG_LEVEL` | no | slog level, e.g. `info`, `debug` |

## Open questions

- **Drone discovery**: Live Flight Log Service's current spec only exposes `GET /drones/{serial}/positions[...]` for a *known* serial — there's no endpoint to list which drones currently exist/are active. This simulator needs one (e.g. a `GET /drones` or a bulk "latest positions" endpoint) before step 2 of the simulation loop is actually implementable; not yet added to that service's spec.
- What creates sensors and their profiles in the first place. This module only discovers and simulates them — it never `POST`s a sensor or `PUT`s a profile. Presumably an operator (via Sensor Flight Log Service's Swagger UI) or a separate seed script, neither of which exists yet.
- Exact report-ID scheme (see Technologies) once a Go cuid2-equivalent is chosen.
- `DISCOVERY_POLL_INTERVAL` default, and what happens if a profile doesn't parse into the shape this module expects (malformed/missing tuning fields) — skip that sensor with a logged error is the likely answer, not yet specified.
- Whether this module needs to persist/resume any state across restarts, or is fully stateless (favoring stateless, driven entirely by what discovery finds, unless a reason to persist emerges).
- Docker packaging details (multi-stage `golang:<version>-alpine` build stage, scratch/distroless runtime stage, image name `mnserver.internal:5000/utmimic-sensor-array-simulator:latest`) — deferred until there's code to build.
