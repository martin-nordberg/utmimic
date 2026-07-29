import { sql } from '../db';

/** Fields required to record a new position report. */
export interface PositionReportInput {
  reportId: string;
  recordedAt: string;
  latitude: number;
  longitude: number;
  altitudeFt: number;
}

/** A persisted position report, as returned to API clients. */
export interface PositionReportRecord {
  reportId: string;
  droneSerialNumber: string;
  recordedAt: string;
  latitude: number;
  longitude: number;
  altitudeFt: number;
  ingestedAt: string;
}

/** Optional time-range and limit filters for listing position reports. */
export interface PositionReportQuery {
  from?: string;
  to?: string;
  limit?: number;
}

/** Raw `position_reports` table row shape, before mapping to `PositionReportRecord`. */
interface PositionReportRow {
  report_id: string;
  drone_serial_number: string;
  recorded_at: Date;
  latitude: number;
  longitude: number;
  altitude_ft: number;
  ingested_at: Date;
}

/** Maps a raw position report row to its API record shape. */
function mapRow(row: PositionReportRow): PositionReportRecord {
  return {
    reportId: row.report_id,
    droneSerialNumber: row.drone_serial_number,
    recordedAt: row.recorded_at.toISOString(),
    latitude: row.latitude,
    longitude: row.longitude,
    altitudeFt: row.altitude_ft,
    ingestedAt: row.ingested_at.toISOString(),
  };
}

/** Inserts position reports for a drone, skipping duplicates by (recordedAt, reportId). */
export async function insertPositionReports(
  droneSerialNumber: string,
  reports: PositionReportInput[],
): Promise<PositionReportRecord[]> {
  const rows = reports.map((report) => ({
    report_id: report.reportId,
    drone_serial_number: droneSerialNumber,
    recorded_at: report.recordedAt,
    latitude: report.latitude,
    longitude: report.longitude,
    altitude_ft: report.altitudeFt,
  }));

  const inserted = await sql<PositionReportRow[]>`
    INSERT INTO live_flight_log.position_reports ${sql(
      rows,
      'report_id',
      'drone_serial_number',
      'recorded_at',
      'latitude',
      'longitude',
      'altitude_ft',
    )}
    ON CONFLICT (recorded_at, report_id) DO NOTHING
    RETURNING *
  `;
  return inserted.map(mapRow);
}

/** Lists a drone's position history, ascending by recordedAt. */
export async function listPositionReports(
  droneSerialNumber: string,
  query: PositionReportQuery,
): Promise<PositionReportRecord[]> {
  const rows = await sql<PositionReportRow[]>`
    SELECT * FROM live_flight_log.position_reports
    WHERE drone_serial_number = ${droneSerialNumber}
      AND (${query.from ?? null}::timestamptz IS NULL OR recorded_at >= ${query.from ?? null}::timestamptz)
      AND (${query.to ?? null}::timestamptz IS NULL OR recorded_at <= ${query.to ?? null}::timestamptz)
    ORDER BY recorded_at ASC
    LIMIT ${query.limit ?? null}
  `;
  return rows.map(mapRow);
}

/** Fetches a drone's most recently recorded position, or null if none exist. */
export async function getLatestPositionReport(droneSerialNumber: string): Promise<PositionReportRecord | null> {
  const [row] = await sql<PositionReportRow[]>`
    SELECT * FROM live_flight_log.position_reports
    WHERE drone_serial_number = ${droneSerialNumber}
    ORDER BY recorded_at DESC
    LIMIT 1
  `;
  return row ? mapRow(row) : null;
}
