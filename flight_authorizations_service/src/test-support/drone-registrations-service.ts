import { join } from 'node:path';

/** Directory of the sibling drone_registrations_service module, relative to this file. */
const DRONE_REGISTRATIONS_SERVICE_DIR = join(import.meta.dir, '../../../drone_registrations_service');

/** URL polled to detect the spawned instance becoming ready. */
const HEALTHZ_URL = 'http://localhost:8001/healthz';

/** Max time to wait for the spawned instance to answer /healthz before giving up. */
const READY_TIMEOUT_MS = 15000;

/** A running Drone Registrations Service instance, started for integration tests against a real dependency rather than a mock. */
export interface DroneRegistrationsServiceHandle {
  stop(): void;
}

// Cross-service ID validation is this service's whole reason for calling Drone Registrations
// Service, so an integration suite that mocked it out would leave that behavior unverified —
// same "test against real dependencies" preference the project applies to Postgres, extended
// here to a sibling service instead of an external one. Spawned via its own package.json
// entrypoint (bun run src/index.ts) in its own directory, so it picks up its own .env
// (DATABASE_URL) exactly the way it would when run standalone.
/** Spawns a real Drone Registrations Service instance and waits for it to answer /healthz. */
export async function startDroneRegistrationsService(): Promise<DroneRegistrationsServiceHandle> {
  const proc = Bun.spawn(['bun', 'run', 'src/index.ts'], {
    cwd: DRONE_REGISTRATIONS_SERVICE_DIR,
    stdout: 'ignore',
    stderr: 'ignore',
  });

  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(HEALTHZ_URL);
      if (res.status === 200) return { stop: () => proc.kill() };
    } catch {
      // Not ready yet — keep polling until the deadline.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  proc.kill();
  throw new Error(`Drone Registrations Service did not become healthy within ${READY_TIMEOUT_MS}ms`);
}
