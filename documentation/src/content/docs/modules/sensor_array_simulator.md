---
title: Modules - Sensor Array Simulator
description: Command-line tool simulating a network of independent sensors observing live flight positions
---

This module is a stand-alone command-line executable that simulates a network of geographically dispersed, independent
sensors capturing live flight data. Each simulated sensor observes drone positions within its own coverage radius, at
its own polling interval, and reports them with simulated latency and positional imprecision relative to the
ground-truth position.

This module reads ground-truth positions from [Live Flight Log Service](/modules/live_flight_log_service/) and writes
the simulated sensor observations to [Sensor Flight Log Service](/modules/sensor_flight_log_service/). It owns no
database schema of its own — it is purely an HTTP client of those two services.

## Technologies

* Go CLI
* `net/http` (stdlib) for calling the two web services
* `log/slog` (stdlib) with a JSON handler for structured logging to stdout, paralleling the Pino JSON logging used by the other services
* Goroutines, one per simulated sensor, each driven by its own `time.Ticker` — no scheduling/worker-pool library needed
* `encoding/json` (stdlib) for config file and HTTP payload (de)serialization
* Go's built-in `testing` package for unit tests
* TBD: client-generated report ID scheme to parallel the other services' cuid2 idempotency keys (a Go cuid2 implementation, e.g. `github.com/nrednav/cuid2`, or a simpler stdlib-based random ID)
* Packaged in a Docker container running a statically-linked Go binary

## Sensor configuration

Preliminary — the set of simulated sensors is defined in a JSON config file, loaded at startup:

```json
[
  {
    "sensorId": "sensor-001",
    "latitude": 47.6205,
    "longitude": -122.3493,
    "rangeMeters": 5000,
    "pollIntervalMs": { "min": 2000, "max": 5000 },
    "latencyMs": { "min": 200, "max": 1500 },
    "positionErrorStdDev": { "metersHorizontal": 15, "feetVertical": 20 }
  }
]
```

Each sensor has a fixed location and coverage radius (`rangeMeters`), and its own randomized polling interval, latency, and positional-error magnitude — this is what makes the sensors "independent" rather than a single uniform sampling process.

The config file path is supplied via the `SENSOR_CONFIG_PATH` environment variable (see [Configuration](#configuration)).

## Simulation loop

Per simulated sensor, running in its own goroutine:

1. Wait for the next tick, at a randomly chosen interval within `pollIntervalMs`.
2. Fetch candidate drones' current positions from Live Flight Log Service.
3. Filter to drones within `rangeMeters` of the sensor's location (great-circle distance, computed in-process — no PostGIS dependency needed for this simple radius check).
4. For each drone still in range, apply simulated imprecision: independent Gaussian noise on latitude/longitude (`metersHorizontal` std. dev., converted to degrees) and on altitude (`feetVertical` std. dev.).
5. Apply simulated latency: delay the write by a random duration within `latencyMs`, so the sensor's report lands in `sensor_flight_log` after `recordedAt` has already passed — mirroring real transmission/reception lag.
6. `POST` the resulting report to Sensor Flight Log Service, with a freshly generated `reportId` as an idempotency key.

## Open questions

- **Drone discovery**: Live Flight Log Service's current spec only exposes `GET /drones/{serial}/positions[...]` for a *known* serial — there's no endpoint to list which drones currently exist/are active. This simulator needs one (e.g. a `GET /drones` or a bulk "latest positions" endpoint) before step 2 above is actually implementable; not yet added to that service's spec.
- Exact idempotency-key scheme (see Technologies) once a Go cuid2-equivalent is chosen.
- Default sensor layout (how many sensors, where) — the config file format above is a sketch, not a committed default deployment.
- Whether the simulator needs to persist/resume any state across restarts, or is fully stateless (favoring stateless, driven entirely by the config file and the two upstream/downstream services, unless a reason to persist emerges).
- Docker packaging details (multi-stage `golang:<version>-alpine` build stage, scratch/distroless runtime stage, image name `mnserver.internal:5000/utmimic-sensor-array-simulator:latest`) — deferred until there's code to build.
