import { sql } from '../db';
import { geomFromGeoJson, polygonSelect } from '../geo';
import type { Polygon } from '../schemas/geojson';

/** Visibility zone state values, matching the table's CHECK constraint. */
export type VisibilityState = 'clear' | 'cloudy' | 'foggy' | 'rainy' | 'stormy';

/** Fields required to record a new visibility report. */
export interface VisibilityReportInput {
  reportId: string;
  recordedAt: string;
  state: VisibilityState;
  ceilingFt?: number;
  polygon: Polygon;
}

/** A persisted visibility report, as returned to API clients. */
export interface VisibilityReportRecord {
  reportId: string;
  zoneId: string;
  recordedAt: string;
  state: VisibilityState;
  ceilingFt?: number;
  polygon: Polygon;
  ingestedAt: string;
}

/** Optional time-range/limit or single-instant filters for a zone's report history. */
export interface VisibilityHistoryQuery {
  from?: string;
  to?: string;
  limit?: number;
  at?: string;
}

/** Raw report-table row shape (observed and forecast tables share this shape), before mapping to `VisibilityReportRecord`. */
interface VisibilityReportRow {
  report_id: string;
  zone_id: string;
  recorded_at: Date;
  state: string;
  ceiling_ft: number | null;
  polygon: Polygon;
  ingested_at: Date;
}

/** Maps a raw report row to its API record shape. */
function mapRow(row: VisibilityReportRow): VisibilityReportRecord {
  return {
    reportId: row.report_id,
    zoneId: row.zone_id,
    recordedAt: row.recorded_at.toISOString(),
    state: row.state as VisibilityState,
    ceilingFt: row.ceiling_ft ?? undefined,
    polygon: row.polygon,
    ingestedAt: row.ingested_at.toISOString(),
  };
}

/** Inserts observed visibility reports for a zone, skipping duplicates by (recordedAt, reportId). */
export async function insertObservedReports(
  zoneId: string,
  reports: VisibilityReportInput[],
): Promise<VisibilityReportRecord[]> {
  const inserted: VisibilityReportRow[] = [];
  for (const report of reports) {
    const rows = await sql<VisibilityReportRow[]>`
      INSERT INTO weather.visibility_observed_reports (report_id, zone_id, recorded_at, state, ceiling_ft, geom)
      VALUES (
        ${report.reportId}, ${zoneId}, ${report.recordedAt}::timestamptz, ${report.state},
        ${report.ceilingFt ?? null}, ${geomFromGeoJson(report.polygon)}
      )
      ON CONFLICT (recorded_at, report_id) DO NOTHING
      RETURNING report_id, zone_id, recorded_at, state, ceiling_ft, ${polygonSelect}, ingested_at
    `;
    inserted.push(...rows);
  }
  return inserted.map(mapRow);
}

/** Inserts forecast visibility reports for a zone, skipping duplicates by (recordedAt, reportId). */
export async function insertForecastReports(
  zoneId: string,
  reports: VisibilityReportInput[],
): Promise<VisibilityReportRecord[]> {
  const inserted: VisibilityReportRow[] = [];
  for (const report of reports) {
    const rows = await sql<VisibilityReportRow[]>`
      INSERT INTO weather.visibility_forecast_reports (report_id, zone_id, recorded_at, state, ceiling_ft, geom)
      VALUES (
        ${report.reportId}, ${zoneId}, ${report.recordedAt}::timestamptz, ${report.state},
        ${report.ceilingFt ?? null}, ${geomFromGeoJson(report.polygon)}
      )
      ON CONFLICT (recorded_at, report_id) DO NOTHING
      RETURNING report_id, zone_id, recorded_at, state, ceiling_ft, ${polygonSelect}, ingested_at
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
): Promise<VisibilityReportRecord[]> {
  const rows = at
    ? await sql<VisibilityReportRow[]>`
        SELECT DISTINCT ON (zone_id) report_id, zone_id, recorded_at, state, ceiling_ft, ${polygonSelect}, ingested_at
        FROM weather.visibility_observed_reports
        WHERE recorded_at <= ${at}::timestamptz
        ORDER BY zone_id, recorded_at DESC
      `
    : await sql<VisibilityReportRow[]>`
        SELECT DISTINCT ON (zone_id) report_id, zone_id, recorded_at, state, ceiling_ft, ${polygonSelect}, ingested_at
        FROM weather.visibility_observed_reports
        WHERE recorded_at >= now() - make_interval(mins => ${staleAfterMinutes})
        ORDER BY zone_id, recorded_at DESC
      `;
  return rows.map(mapRow);
}

/** Zone(s) whose latest (or as-of-`at`) observed polygon contains the given point, subject to the same staleness rule as `listLatestObserved`. */
export async function listObservedCurrent(
  lat: number,
  lon: number,
  at: string | undefined,
  staleAfterMinutes: number,
): Promise<VisibilityReportRecord[]> {
  const rows = at
    ? await sql<VisibilityReportRow[]>`
        SELECT report_id, zone_id, recorded_at, state, ceiling_ft, ${polygonSelect}, ingested_at
        FROM (
          SELECT DISTINCT ON (zone_id) report_id, zone_id, recorded_at, state, ceiling_ft, geom, ingested_at
          FROM weather.visibility_observed_reports
          WHERE recorded_at <= ${at}::timestamptz
          ORDER BY zone_id, recorded_at DESC
        ) latest
        WHERE ST_Contains(geom, ST_SetSRID(ST_MakePoint(${lon}, ${lat}), 4326))
      `
    : await sql<VisibilityReportRow[]>`
        SELECT report_id, zone_id, recorded_at, state, ceiling_ft, ${polygonSelect}, ingested_at
        FROM (
          SELECT DISTINCT ON (zone_id) report_id, zone_id, recorded_at, state, ceiling_ft, geom, ingested_at
          FROM weather.visibility_observed_reports
          WHERE recorded_at >= now() - make_interval(mins => ${staleAfterMinutes})
          ORDER BY zone_id, recorded_at DESC
        ) latest
        WHERE ST_Contains(geom, ST_SetSRID(ST_MakePoint(${lon}, ${lat}), 4326))
      `;
  return rows.map(mapRow);
}

/** A single zone's most recently observed report, or null if none exist within `staleAfterMinutes` of now. */
export async function getZoneObservedLatest(
  zoneId: string,
  staleAfterMinutes: number,
): Promise<VisibilityReportRecord | null> {
  const [row] = await sql<VisibilityReportRow[]>`
    SELECT report_id, zone_id, recorded_at, state, ceiling_ft, ${polygonSelect}, ingested_at
    FROM weather.visibility_observed_reports
    WHERE zone_id = ${zoneId} AND recorded_at >= now() - make_interval(mins => ${staleAfterMinutes})
    ORDER BY recorded_at DESC
    LIMIT 1
  `;
  return row ? mapRow(row) : null;
}

/** A zone's observed report history: a `from`/`to`/`limit` range, or the single report as of `at` (no staleness filter — the caller is asking about the past). */
export async function listZoneObservedHistory(
  zoneId: string,
  query: VisibilityHistoryQuery,
): Promise<VisibilityReportRecord[]> {
  if (query.at) {
    const rows = await sql<VisibilityReportRow[]>`
      SELECT report_id, zone_id, recorded_at, state, ceiling_ft, ${polygonSelect}, ingested_at
      FROM weather.visibility_observed_reports
      WHERE zone_id = ${zoneId} AND recorded_at <= ${query.at}::timestamptz
      ORDER BY recorded_at DESC
      LIMIT 1
    `;
    return rows.map(mapRow);
  }

  const rows = await sql<VisibilityReportRow[]>`
    SELECT report_id, zone_id, recorded_at, state, ceiling_ft, ${polygonSelect}, ingested_at
    FROM weather.visibility_observed_reports
    WHERE zone_id = ${zoneId}
      AND (${query.from ?? null}::timestamptz IS NULL OR recorded_at >= ${query.from ?? null}::timestamptz)
      AND (${query.to ?? null}::timestamptz IS NULL OR recorded_at <= ${query.to ?? null}::timestamptz)
    ORDER BY recorded_at ASC
    LIMIT ${query.limit ?? null}
  `;
  return rows.map(mapRow);
}

/** Each zone's forecast whose `recordedAt` is closest to `at`; ties broken by the most recently issued (`ingestedAt`). */
export async function listLatestForecast(at: string): Promise<VisibilityReportRecord[]> {
  const rows = await sql<VisibilityReportRow[]>`
    SELECT DISTINCT ON (zone_id) report_id, zone_id, recorded_at, state, ceiling_ft, ${polygonSelect}, ingested_at
    FROM weather.visibility_forecast_reports
    ORDER BY zone_id, abs(extract(epoch FROM recorded_at - ${at}::timestamptz)), ingested_at DESC
  `;
  return rows.map(mapRow);
}

/** Zone(s) whose forecast polygon (for the closest `recordedAt` to `at`) contains the given point. */
export async function listForecastCurrent(lat: number, lon: number, at: string): Promise<VisibilityReportRecord[]> {
  const rows = await sql<VisibilityReportRow[]>`
    SELECT report_id, zone_id, recorded_at, state, ceiling_ft, ${polygonSelect}, ingested_at
    FROM (
      SELECT DISTINCT ON (zone_id) report_id, zone_id, recorded_at, state, ceiling_ft, geom, ingested_at
      FROM weather.visibility_forecast_reports
      ORDER BY zone_id, abs(extract(epoch FROM recorded_at - ${at}::timestamptz)), ingested_at DESC
    ) closest
    WHERE ST_Contains(geom, ST_SetSRID(ST_MakePoint(${lon}, ${lat}), 4326))
  `;
  return rows.map(mapRow);
}

/** A zone's forecast history: a `from`/`to`/`limit` range, or the single forecast closest to `at` (ties broken by latest `ingestedAt`). */
export async function listZoneForecastHistory(
  zoneId: string,
  query: VisibilityHistoryQuery,
): Promise<VisibilityReportRecord[]> {
  if (query.at) {
    const rows = await sql<VisibilityReportRow[]>`
      SELECT report_id, zone_id, recorded_at, state, ceiling_ft, ${polygonSelect}, ingested_at
      FROM weather.visibility_forecast_reports
      WHERE zone_id = ${zoneId}
      ORDER BY abs(extract(epoch FROM recorded_at - ${query.at}::timestamptz)), ingested_at DESC
      LIMIT 1
    `;
    return rows.map(mapRow);
  }

  const rows = await sql<VisibilityReportRow[]>`
    SELECT report_id, zone_id, recorded_at, state, ceiling_ft, ${polygonSelect}, ingested_at
    FROM weather.visibility_forecast_reports
    WHERE zone_id = ${zoneId}
      AND (${query.from ?? null}::timestamptz IS NULL OR recorded_at >= ${query.from ?? null}::timestamptz)
      AND (${query.to ?? null}::timestamptz IS NULL OR recorded_at <= ${query.to ?? null}::timestamptz)
    ORDER BY recorded_at ASC
    LIMIT ${query.limit ?? null}
  `;
  return rows.map(mapRow);
}
