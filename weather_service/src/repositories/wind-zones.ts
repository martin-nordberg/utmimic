import { sql } from '../db';
import { geomFromGeoJson, polygonSelect, type SpatialFilter, spatialFilterCondition } from '../geo';
import type { Polygon } from '../schemas/geojson';

/** Wind zone state values, matching the table's CHECK constraint. */
export type WindState = 'calm' | 'slight_winds' | 'heavy_winds' | 'dangerous_winds';

/** Fields required to record a new wind report. */
export interface WindReportInput {
  reportId: string;
  recordedAt: string;
  state: WindState;
  polygon: Polygon;
}

/** A persisted wind report, as returned to API clients. */
export interface WindReportRecord {
  reportId: string;
  zoneId: string;
  recordedAt: string;
  state: WindState;
  polygon: Polygon;
  ingestedAt: string;
}

/** Optional time-range/limit or single-instant filters for a zone's report history. */
export interface WindHistoryQuery {
  from?: string;
  to?: string;
  limit?: number;
  at?: string;
}

/** Raw report-table row shape (observed and forecast tables share this shape), before mapping to `WindReportRecord`. */
interface WindReportRow {
  report_id: string;
  zone_id: string;
  recorded_at: Date;
  state: string;
  polygon: Polygon;
  ingested_at: Date;
}

/** Maps a raw report row to its API record shape. */
function mapRow(row: WindReportRow): WindReportRecord {
  return {
    reportId: row.report_id,
    zoneId: row.zone_id,
    recordedAt: row.recorded_at.toISOString(),
    state: row.state as WindState,
    polygon: row.polygon,
    ingestedAt: row.ingested_at.toISOString(),
  };
}

/** Inserts observed wind reports for a zone, skipping duplicates by (recordedAt, reportId). */
export async function insertObservedReports(
  zoneId: string,
  reports: WindReportInput[],
): Promise<WindReportRecord[]> {
  const inserted: WindReportRow[] = [];
  for (const report of reports) {
    const rows = await sql<WindReportRow[]>`
      INSERT INTO weather.wind_observed_reports (report_id, zone_id, recorded_at, state, geom)
      VALUES (
        ${report.reportId}, ${zoneId}, ${report.recordedAt}::timestamptz, ${report.state},
        ${geomFromGeoJson(report.polygon)}
      )
      ON CONFLICT (recorded_at, report_id) DO NOTHING
      RETURNING report_id, zone_id, recorded_at, state, ${polygonSelect}, ingested_at
    `;
    inserted.push(...rows);
  }
  return inserted.map(mapRow);
}

/** Inserts forecast wind reports for a zone, skipping duplicates by (recordedAt, reportId). */
export async function insertForecastReports(
  zoneId: string,
  reports: WindReportInput[],
): Promise<WindReportRecord[]> {
  const inserted: WindReportRow[] = [];
  for (const report of reports) {
    const rows = await sql<WindReportRow[]>`
      INSERT INTO weather.wind_forecast_reports (report_id, zone_id, recorded_at, state, geom)
      VALUES (
        ${report.reportId}, ${zoneId}, ${report.recordedAt}::timestamptz, ${report.state},
        ${geomFromGeoJson(report.polygon)}
      )
      ON CONFLICT (recorded_at, report_id) DO NOTHING
      RETURNING report_id, zone_id, recorded_at, state, ${polygonSelect}, ingested_at
    `;
    inserted.push(...rows);
  }
  return inserted.map(mapRow);
}

/**
 * Latest observed report per zone, or each zone's most recent report as of `at` when given.
 * With no `at`, a zone is only included if its latest report is within `staleAfterMinutes` of now.
 */
export async function listLatestObserved(
  at: string | undefined,
  staleAfterMinutes: number,
): Promise<WindReportRecord[]> {
  const rows = at
    ? await sql<WindReportRow[]>`
        SELECT DISTINCT ON (zone_id) report_id, zone_id, recorded_at, state, ${polygonSelect}, ingested_at
        FROM weather.wind_observed_reports
        WHERE recorded_at <= ${at}::timestamptz
        ORDER BY zone_id, recorded_at DESC
      `
    : await sql<WindReportRow[]>`
        SELECT DISTINCT ON (zone_id) report_id, zone_id, recorded_at, state, ${polygonSelect}, ingested_at
        FROM weather.wind_observed_reports
        WHERE recorded_at >= now() - make_interval(mins => ${staleAfterMinutes})
        ORDER BY zone_id, recorded_at DESC
      `;
  return rows.map(mapRow);
}

/** Zone(s) whose latest (or as-of-`at`) observed polygon matches the given spatial filter (point or extent), subject to the same staleness rule as `listLatestObserved`. */
export async function listObservedCurrent(
  filter: SpatialFilter,
  at: string | undefined,
  staleAfterMinutes: number,
): Promise<WindReportRecord[]> {
  const rows = at
    ? await sql<WindReportRow[]>`
        SELECT report_id, zone_id, recorded_at, state, ${polygonSelect}, ingested_at
        FROM (
          SELECT DISTINCT ON (zone_id) report_id, zone_id, recorded_at, state, geom, ingested_at
          FROM weather.wind_observed_reports
          WHERE recorded_at <= ${at}::timestamptz
          ORDER BY zone_id, recorded_at DESC
        ) latest
        WHERE ${spatialFilterCondition(filter)}
      `
    : await sql<WindReportRow[]>`
        SELECT report_id, zone_id, recorded_at, state, ${polygonSelect}, ingested_at
        FROM (
          SELECT DISTINCT ON (zone_id) report_id, zone_id, recorded_at, state, geom, ingested_at
          FROM weather.wind_observed_reports
          WHERE recorded_at >= now() - make_interval(mins => ${staleAfterMinutes})
          ORDER BY zone_id, recorded_at DESC
        ) latest
        WHERE ${spatialFilterCondition(filter)}
      `;
  return rows.map(mapRow);
}

/** A single zone's most recently observed report, or null if none exist within `staleAfterMinutes` of now. */
export async function getZoneObservedLatest(
  zoneId: string,
  staleAfterMinutes: number,
): Promise<WindReportRecord | null> {
  const [row] = await sql<WindReportRow[]>`
    SELECT report_id, zone_id, recorded_at, state, ${polygonSelect}, ingested_at
    FROM weather.wind_observed_reports
    WHERE zone_id = ${zoneId} AND recorded_at >= now() - make_interval(mins => ${staleAfterMinutes})
    ORDER BY recorded_at DESC
    LIMIT 1
  `;
  return row ? mapRow(row) : null;
}

/** A zone's observed report history: a `from`/`to`/`limit` range, or the single report as of `at` (no staleness filter — the caller is asking about the past). */
export async function listZoneObservedHistory(
  zoneId: string,
  query: WindHistoryQuery,
): Promise<WindReportRecord[]> {
  if (query.at) {
    const rows = await sql<WindReportRow[]>`
      SELECT report_id, zone_id, recorded_at, state, ${polygonSelect}, ingested_at
      FROM weather.wind_observed_reports
      WHERE zone_id = ${zoneId} AND recorded_at <= ${query.at}::timestamptz
      ORDER BY recorded_at DESC
      LIMIT 1
    `;
    return rows.map(mapRow);
  }

  const rows = await sql<WindReportRow[]>`
    SELECT report_id, zone_id, recorded_at, state, ${polygonSelect}, ingested_at
    FROM weather.wind_observed_reports
    WHERE zone_id = ${zoneId}
      AND (${query.from ?? null}::timestamptz IS NULL OR recorded_at >= ${query.from ?? null}::timestamptz)
      AND (${query.to ?? null}::timestamptz IS NULL OR recorded_at <= ${query.to ?? null}::timestamptz)
    ORDER BY recorded_at ASC
    LIMIT ${query.limit ?? null}
  `;
  return rows.map(mapRow);
}

/** Each zone's forecast whose `recordedAt` is closest to `at`; ties broken by the most recently issued (`ingestedAt`). */
export async function listLatestForecast(at: string): Promise<WindReportRecord[]> {
  const rows = await sql<WindReportRow[]>`
    SELECT DISTINCT ON (zone_id) report_id, zone_id, recorded_at, state, ${polygonSelect}, ingested_at
    FROM weather.wind_forecast_reports
    ORDER BY zone_id, abs(extract(epoch FROM recorded_at - ${at}::timestamptz)), ingested_at DESC
  `;
  return rows.map(mapRow);
}

/** Zone(s) whose forecast polygon (for the closest `recordedAt` to `at`) matches the given spatial filter (point or extent). */
export async function listForecastCurrent(filter: SpatialFilter, at: string): Promise<WindReportRecord[]> {
  const rows = await sql<WindReportRow[]>`
    SELECT report_id, zone_id, recorded_at, state, ${polygonSelect}, ingested_at
    FROM (
      SELECT DISTINCT ON (zone_id) report_id, zone_id, recorded_at, state, geom, ingested_at
      FROM weather.wind_forecast_reports
      ORDER BY zone_id, abs(extract(epoch FROM recorded_at - ${at}::timestamptz)), ingested_at DESC
    ) closest
    WHERE ${spatialFilterCondition(filter)}
  `;
  return rows.map(mapRow);
}

/** A zone's forecast history: a `from`/`to`/`limit` range, or the single forecast closest to `at` (ties broken by latest `ingestedAt`). */
export async function listZoneForecastHistory(
  zoneId: string,
  query: WindHistoryQuery,
): Promise<WindReportRecord[]> {
  if (query.at) {
    const rows = await sql<WindReportRow[]>`
      SELECT report_id, zone_id, recorded_at, state, ${polygonSelect}, ingested_at
      FROM weather.wind_forecast_reports
      WHERE zone_id = ${zoneId}
      ORDER BY abs(extract(epoch FROM recorded_at - ${query.at}::timestamptz)), ingested_at DESC
      LIMIT 1
    `;
    return rows.map(mapRow);
  }

  const rows = await sql<WindReportRow[]>`
    SELECT report_id, zone_id, recorded_at, state, ${polygonSelect}, ingested_at
    FROM weather.wind_forecast_reports
    WHERE zone_id = ${zoneId}
      AND (${query.from ?? null}::timestamptz IS NULL OR recorded_at >= ${query.from ?? null}::timestamptz)
      AND (${query.to ?? null}::timestamptz IS NULL OR recorded_at <= ${query.to ?? null}::timestamptz)
    ORDER BY recorded_at ASC
    LIMIT ${query.limit ?? null}
  `;
  return rows.map(mapRow);
}
