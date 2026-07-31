import { SQL } from 'bun';
import { getRegistrationOwnerId, ownerExists, pilotExistsUnderOwner } from '../drone-registrations-client';
import { sql } from '../db';
import { geomFromGeoJson, intersectsEnvelope, pointFromLatLon, pointLatLonSelect } from '../geo';
import type { Polygon } from '../schemas/geojson';

/** A single flight-plan waypoint, as stored/returned — same shape on input and output. */
export interface WaypointRecord {
  latitude: number;
  longitude: number;
  altitudeMinFt: number;
  altitudeMaxFt: number;
  radiusMeters: number;
}

/** Fields shared by both `planType` branches of a new flight plan. */
interface CreateFlightPlanCommon {
  flightPlanId: string;
  ownerId: string;
  registrationId?: string | null;
  pilotId?: string | null;
  airspaceAuthorizationId?: string | null;
  startTime: string;
  endTime: string;
}

/** Fields required to create a new flight plan — a discriminated union on `planType`, mirroring the table's mutually-exclusive shapes. */
export type CreateFlightPlanInput =
  | (CreateFlightPlanCommon & { planType: 'waypoints'; waypoints: WaypointRecord[] })
  | (CreateFlightPlanCommon & { planType: 'polygon'; polygonArea: Polygon; polygonMaxAltitudeFt: number });

// registrationId/pilotId/airspaceAuthorizationId are nullable and independently patchable (link,
// or unlink by clearing to null) — same 'key in patch' handling as
// airspace-authorizations.ts's pilotId, since a plain COALESCE can't distinguish "omitted" from
// "explicitly null."
/** Fields to partially update on an existing flight plan; `planType`/`ownerId`/shape are immutable. */
export interface FlightPlanPatch {
  registrationId?: string | null;
  pilotId?: string | null;
  airspaceAuthorizationId?: string | null;
  startTime?: string;
  endTime?: string;
}

/** Fields shared by both `planType` branches of a persisted flight plan. */
interface FlightPlanCommon {
  flightPlanId: string;
  ownerId: string;
  registrationId: string | null;
  pilotId: string | null;
  airspaceAuthorizationId: string | null;
  startTime: string;
  endTime: string;
  createdAt: string;
  updatedAt: string;
}

/** A persisted flight plan, as returned to API clients — a discriminated union on `planType`. */
export type FlightPlanRecord =
  | (FlightPlanCommon & { planType: 'waypoints'; waypoints: WaypointRecord[] })
  | (FlightPlanCommon & { planType: 'polygon'; polygonArea: Polygon; polygonMaxAltitudeFt: number });

/** Optional filters for listing flight plans, AND'd together. */
export interface ListFlightPlansFilter {
  ownerId?: string;
  registrationId?: string;
  pilotId?: string;
  airspaceAuthorizationId?: string;
  activeAt?: string;
}

/** Thrown when creating a flight plan whose id already exists. */
export class FlightPlanAlreadyExistsError extends Error {
  constructor(flightPlanId: string) {
    super(`Flight plan ${flightPlanId} already exists`);
  }
}

/** Thrown when the given `ownerId` doesn't exist in Drone Registrations Service. */
export class OwnerNotFoundError extends Error {
  constructor(ownerId: string) {
    super(`Owner ${ownerId} not found`);
  }
}

/** Thrown when the given `pilotId` doesn't exist under the flight plan's owner in Drone Registrations Service. */
export class PilotNotFoundError extends Error {
  constructor(pilotId: string) {
    super(`Pilot ${pilotId} not found`);
  }
}

/** Thrown when the given `registrationId` doesn't exist in Drone Registrations Service. */
export class RegistrationNotFoundError extends Error {
  constructor(registrationId: string) {
    super(`Drone registration ${registrationId} not found`);
  }
}

/** Thrown when the given `registrationId` exists but belongs to a different owner than the flight plan's `ownerId`. */
export class RegistrationOwnerMismatchError extends Error {
  constructor(registrationId: string, ownerId: string) {
    super(`Drone registration ${registrationId} does not belong to owner ${ownerId}`);
  }
}

/** Thrown when the given `airspaceAuthorizationId` doesn't reference an existing authorization (a same-schema FK, caught from the DB rather than pre-checked). */
export class AirspaceAuthorizationNotFoundError extends Error {
  constructor(airspaceAuthorizationId: string) {
    super(`Airspace authorization ${airspaceAuthorizationId} not found`);
  }
}

/** Raw `flight_plans` table row shape (with `polygon_area` already converted to GeoJSON by the query, null for `'waypoints'` rows), before mapping to `FlightPlanRecord`. */
interface FlightPlanRow {
  flight_plan_id: string;
  plan_type: 'waypoints' | 'polygon';
  owner_id: string;
  registration_id: string | null;
  pilot_id: string | null;
  airspace_authorization_id: string | null;
  start_time: Date;
  end_time: Date;
  polygon_area: Polygon | null;
  polygon_max_altitude_ft: number | null;
  created_at: Date;
  updated_at: Date;
}

/** Raw `flight_plan_waypoints` row shape (with `point` already converted to flat lat/lon by the query), before mapping to `WaypointRecord`. */
interface WaypointRow {
  flight_plan_id: string;
  sequence_number: number;
  latitude: number;
  longitude: number;
  altitude_min_ft: number;
  altitude_max_ft: number;
  radius_meters: number;
}

/** Columns selected by every `flight_plans` query below, converting `polygon_area` to GeoJSON at the SQL layer. */
const SELECT_FLIGHT_PLAN_COLUMNS = sql`
  flight_plan_id, plan_type, owner_id, registration_id, pilot_id, airspace_authorization_id,
  start_time, end_time, ST_AsGeoJSON(polygon_area)::json AS polygon_area, polygon_max_altitude_ft,
  created_at, updated_at
`;

/** Maps a raw flight plan row plus its (already-fetched) waypoints to its API record shape. */
function mapRow(row: FlightPlanRow, waypoints: WaypointRecord[]): FlightPlanRecord {
  const common = {
    flightPlanId: row.flight_plan_id,
    ownerId: row.owner_id,
    registrationId: row.registration_id,
    pilotId: row.pilot_id,
    airspaceAuthorizationId: row.airspace_authorization_id,
    startTime: row.start_time.toISOString(),
    endTime: row.end_time.toISOString(),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
  if (row.plan_type === 'waypoints') {
    return { ...common, planType: 'waypoints', waypoints };
  }
  return { ...common, planType: 'polygon', polygonArea: row.polygon_area!, polygonMaxAltitudeFt: row.polygon_max_altitude_ft! };
}

/** Fetches every waypoint for the given flight plan ids, grouped by id and ordered by `sequenceNumber`. */
async function fetchWaypointsFor(flightPlanIds: string[]): Promise<Map<string, WaypointRecord[]>> {
  const map = new Map<string, WaypointRecord[]>();
  if (flightPlanIds.length === 0) return map;

  const rows = await sql<WaypointRow[]>`
    SELECT flight_plan_id, sequence_number, ${pointLatLonSelect}, altitude_min_ft, altitude_max_ft, radius_meters
    FROM flight_authorizations.flight_plan_waypoints
    WHERE flight_plan_id = ANY(${sql.array(flightPlanIds, 'TEXT')})
    ORDER BY flight_plan_id, sequence_number
  `;
  for (const row of rows) {
    const waypoints = map.get(row.flight_plan_id) ?? [];
    waypoints.push({
      latitude: row.latitude,
      longitude: row.longitude,
      altitudeMinFt: row.altitude_min_ft,
      altitudeMaxFt: row.altitude_max_ft,
      radiusMeters: row.radius_meters,
    });
    map.set(row.flight_plan_id, waypoints);
  }
  return map;
}

/**
 * Creates a new flight plan. Validates `ownerId`, `pilotId` (if given), and `registrationId` (if
 * given — also checking it belongs to `ownerId`) against Drone Registrations Service before
 * writing. For a `'waypoints'` plan, the plan row and all its waypoint rows are inserted in a
 * single transaction (`sql.begin`) so they commit or fail together. Throws
 * `FlightPlanAlreadyExistsError` if the id is taken, or `AirspaceAuthorizationNotFoundError` if a
 * given `airspaceAuthorizationId` doesn't exist (an FK-violation catch, not a pre-check, since
 * that's a same-schema reference).
 */
export async function insertFlightPlan(input: CreateFlightPlanInput): Promise<FlightPlanRecord> {
  if (!(await ownerExists(input.ownerId))) throw new OwnerNotFoundError(input.ownerId);
  if (input.pilotId != null && !(await pilotExistsUnderOwner(input.ownerId, input.pilotId))) {
    throw new PilotNotFoundError(input.pilotId);
  }
  if (input.registrationId != null) {
    const registrationOwnerId = await getRegistrationOwnerId(input.registrationId);
    if (registrationOwnerId === null) throw new RegistrationNotFoundError(input.registrationId);
    if (registrationOwnerId !== input.ownerId) {
      throw new RegistrationOwnerMismatchError(input.registrationId, input.ownerId);
    }
  }

  try {
    const row = await sql.begin(async (tx) => {
      const [inserted] = await tx<FlightPlanRow[]>`
        INSERT INTO flight_authorizations.flight_plans (
          flight_plan_id, plan_type, owner_id, registration_id, pilot_id, airspace_authorization_id,
          start_time, end_time, polygon_area, polygon_max_altitude_ft
        ) VALUES (
          ${input.flightPlanId}, ${input.planType}, ${input.ownerId}, ${input.registrationId ?? null},
          ${input.pilotId ?? null}, ${input.airspaceAuthorizationId ?? null},
          ${input.startTime}::timestamptz, ${input.endTime}::timestamptz,
          ${input.planType === 'polygon' ? geomFromGeoJson(input.polygonArea) : null},
          ${input.planType === 'polygon' ? input.polygonMaxAltitudeFt : null}
        )
        RETURNING ${SELECT_FLIGHT_PLAN_COLUMNS}
      `;

      if (input.planType === 'waypoints') {
        for (const [sequenceNumber, waypoint] of input.waypoints.entries()) {
          await tx`
            INSERT INTO flight_authorizations.flight_plan_waypoints
              (flight_plan_id, sequence_number, point, altitude_min_ft, altitude_max_ft, radius_meters)
            VALUES (
              ${input.flightPlanId}, ${sequenceNumber}, ${pointFromLatLon(waypoint.latitude, waypoint.longitude)},
              ${waypoint.altitudeMinFt}, ${waypoint.altitudeMaxFt}, ${waypoint.radiusMeters}
            )
          `;
        }
      }

      return inserted!;
    });

    const waypoints = input.planType === 'waypoints' ? input.waypoints : [];
    return mapRow(row, waypoints);
  } catch (err) {
    if (err instanceof SQL.PostgresError && err.errno === '23505') {
      throw new FlightPlanAlreadyExistsError(input.flightPlanId);
    }
    if (err instanceof SQL.PostgresError && err.errno === '23503') {
      throw new AirspaceAuthorizationNotFoundError(input.airspaceAuthorizationId!);
    }
    throw err;
  }
}

/** Lists flight plans, optionally filtered by `ownerId`/`registrationId`/`pilotId`/`airspaceAuthorizationId`/`activeAt`, oldest first. */
export async function listFlightPlans(filter: ListFlightPlansFilter): Promise<FlightPlanRecord[]> {
  const rows = await sql<FlightPlanRow[]>`
    SELECT ${SELECT_FLIGHT_PLAN_COLUMNS}
    FROM flight_authorizations.flight_plans
    WHERE (${filter.ownerId ?? null}::text IS NULL OR owner_id = ${filter.ownerId ?? null}::text)
      AND (${filter.registrationId ?? null}::text IS NULL OR registration_id = ${filter.registrationId ?? null}::text)
      AND (${filter.pilotId ?? null}::text IS NULL OR pilot_id = ${filter.pilotId ?? null}::text)
      AND (
        ${filter.airspaceAuthorizationId ?? null}::text IS NULL
        OR airspace_authorization_id = ${filter.airspaceAuthorizationId ?? null}::text
      )
      AND (
        ${filter.activeAt ?? null}::timestamptz IS NULL
        OR (start_time <= ${filter.activeAt ?? null}::timestamptz AND end_time >= ${filter.activeAt ?? null}::timestamptz)
      )
    ORDER BY created_at
  `;
  const waypointsMap = await fetchWaypointsFor(rows.filter((r) => r.plan_type === 'waypoints').map((r) => r.flight_plan_id));
  return rows.map((row) => mapRow(row, waypointsMap.get(row.flight_plan_id) ?? []));
}

/** Fetches a flight plan by id (including its waypoints, if any), or null if it doesn't exist. */
export async function getFlightPlanById(flightPlanId: string): Promise<FlightPlanRecord | null> {
  const [row] = await sql<FlightPlanRow[]>`
    SELECT ${SELECT_FLIGHT_PLAN_COLUMNS}
    FROM flight_authorizations.flight_plans
    WHERE flight_plan_id = ${flightPlanId}
  `;
  if (!row) return null;

  const waypoints = row.plan_type === 'waypoints' ? (await fetchWaypointsFor([flightPlanId])).get(flightPlanId) ?? [] : [];
  return mapRow(row, waypoints);
}

/**
 * Applies a partial update to a flight plan, or null if it doesn't exist. Only
 * `registrationId`/`pilotId`/`airspaceAuthorizationId`/`startTime`/`endTime` are patchable (see
 * `FlightPlanPatch`); re-validates `pilotId`/`registrationId` against Drone Registrations Service
 * if either is being changed, and lets the `UPDATE`'s own FK catch an invalid
 * `airspaceAuthorizationId`.
 */
export async function updateFlightPlan(flightPlanId: string, patch: FlightPlanPatch): Promise<FlightPlanRecord | null> {
  const existing = await getFlightPlanById(flightPlanId);
  if (!existing) return null;

  if (patch.pilotId != null && !(await pilotExistsUnderOwner(existing.ownerId, patch.pilotId))) {
    throw new PilotNotFoundError(patch.pilotId);
  }
  if (patch.registrationId != null) {
    const registrationOwnerId = await getRegistrationOwnerId(patch.registrationId);
    if (registrationOwnerId === null) throw new RegistrationNotFoundError(patch.registrationId);
    if (registrationOwnerId !== existing.ownerId) {
      throw new RegistrationOwnerMismatchError(patch.registrationId, existing.ownerId);
    }
  }

  const registrationIdProvided = 'registrationId' in patch;
  const pilotIdProvided = 'pilotId' in patch;
  const airspaceAuthorizationIdProvided = 'airspaceAuthorizationId' in patch;

  let row: FlightPlanRow | undefined;
  try {
    [row] = await sql<FlightPlanRow[]>`
      UPDATE flight_authorizations.flight_plans
      SET
        registration_id = CASE WHEN ${registrationIdProvided} THEN ${patch.registrationId ?? null} ELSE registration_id END,
        pilot_id = CASE WHEN ${pilotIdProvided} THEN ${patch.pilotId ?? null} ELSE pilot_id END,
        airspace_authorization_id =
          CASE WHEN ${airspaceAuthorizationIdProvided} THEN ${patch.airspaceAuthorizationId ?? null} ELSE airspace_authorization_id END,
        start_time = COALESCE(${patch.startTime ?? null}::timestamptz, start_time),
        end_time = COALESCE(${patch.endTime ?? null}::timestamptz, end_time),
        updated_at = now()
      WHERE flight_plan_id = ${flightPlanId}
      RETURNING ${SELECT_FLIGHT_PLAN_COLUMNS}
    `;
  } catch (err) {
    if (err instanceof SQL.PostgresError && err.errno === '23503') {
      throw new AirspaceAuthorizationNotFoundError(patch.airspaceAuthorizationId!);
    }
    throw err;
  }
  if (!row) return null;

  // waypoints/shape are immutable, so the existing record's already-fetched waypoints are still
  // correct for the patched row — no need to re-fetch them.
  const waypoints = existing.planType === 'waypoints' ? existing.waypoints : [];
  return mapRow(row, waypoints);
}

/**
 * Flight plan(s) whose shape intersects the given lat/lon bounding box: `'polygon'` plans via
 * their `polygonArea`, `'waypoints'` plans if any waypoint's buffered cylinder
 * (`ST_Buffer(point::geography, radiusMeters)`, computed at query time) intersects.
 * `radiusMeters` is buffered in `geography` space rather than directly on the `geometry`
 * column — a plain `ST_Buffer` on a `geometry(Point, 4326)` treats the radius as *degrees*, not
 * meters, since the geometry's coordinate system is degree-based; `geography` buffers using
 * real-world meters, then gets cast back to `geometry` to intersect with the envelope.
 * `altitudeFt`/`activeAt` are optional; there's no `status` filter, since flight plans don't
 * have one.
 */
export async function listIntersectingFlightPlans(
  minLat: number,
  minLon: number,
  maxLat: number,
  maxLon: number,
  altitudeFt?: number,
  activeAt?: string,
): Promise<FlightPlanRecord[]> {
  const polygonRows = await sql<FlightPlanRow[]>`
    SELECT ${SELECT_FLIGHT_PLAN_COLUMNS}
    FROM flight_authorizations.flight_plans
    WHERE plan_type = 'polygon'
      AND ${intersectsEnvelope(sql`polygon_area`, minLat, minLon, maxLat, maxLon)}
      AND (
        ${altitudeFt ?? null}::double precision IS NULL
        OR polygon_max_altitude_ft >= ${altitudeFt ?? null}::double precision
      )
      AND (
        ${activeAt ?? null}::timestamptz IS NULL
        OR (start_time <= ${activeAt ?? null}::timestamptz AND end_time >= ${activeAt ?? null}::timestamptz)
      )
  `;

  const waypointsPlanRows = await sql<FlightPlanRow[]>`
    SELECT ${SELECT_FLIGHT_PLAN_COLUMNS}
    FROM flight_authorizations.flight_plans fp
    WHERE plan_type = 'waypoints'
      AND (
        ${activeAt ?? null}::timestamptz IS NULL
        OR (start_time <= ${activeAt ?? null}::timestamptz AND end_time >= ${activeAt ?? null}::timestamptz)
      )
      AND EXISTS (
        SELECT 1 FROM flight_authorizations.flight_plan_waypoints w
        WHERE w.flight_plan_id = fp.flight_plan_id
          AND ${intersectsEnvelope(sql`ST_Buffer(w.point::geography, w.radius_meters)::geometry`, minLat, minLon, maxLat, maxLon)}
          AND (
            ${altitudeFt ?? null}::double precision IS NULL
            OR (
              ${altitudeFt ?? null}::double precision > w.altitude_min_ft
              AND ${altitudeFt ?? null}::double precision <= w.altitude_max_ft
            )
          )
      )
  `;

  const waypointsMap = await fetchWaypointsFor(waypointsPlanRows.map((r) => r.flight_plan_id));
  return [...polygonRows, ...waypointsPlanRows]
    .sort((a, b) => a.created_at.getTime() - b.created_at.getTime())
    .map((row) => mapRow(row, waypointsMap.get(row.flight_plan_id) ?? []));
}
