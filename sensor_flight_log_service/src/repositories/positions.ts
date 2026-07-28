import { sql } from '../db';

export interface PositionReportInput {
  reportId: string;
  sensorId: string;
  recordedAt: string;
  latitude: number;
  longitude: number;
  altitudeFt: number;
}

export interface PositionReportRecord {
  reportId: string;
  sensorId: string;
  droneSerialNumber: string;
  recordedAt: string;
  latitude: number;
  longitude: number;
  altitudeFt: number;
  ingestedAt: string;
}

export interface PositionReportQuery {
  from?: string;
  to?: string;
  limit?: number;
}

interface PositionReportRow {
  report_id: string;
  sensor_id: string;
  drone_serial_number: string;
  recorded_at: Date;
  latitude: number;
  longitude: number;
  altitude_ft: number;
  ingested_at: Date;
}

function mapRow(row: PositionReportRow): PositionReportRecord {
  return {
    reportId: row.report_id,
    sensorId: row.sensor_id,
    droneSerialNumber: row.drone_serial_number,
    recordedAt: row.recorded_at.toISOString(),
    latitude: row.latitude,
    longitude: row.longitude,
    altitudeFt: row.altitude_ft,
    ingestedAt: row.ingested_at.toISOString(),
  };
}

export async function findMissingSensorIds(sensorIds: string[]): Promise<string[]> {
  const uniqueIds = [...new Set(sensorIds)];
  const rows = await sql<{ sensor_id: string }[]>`
    SELECT sensor_id FROM sensor_flight_log.sensors WHERE sensor_id = ANY(${sql.array(uniqueIds, 'TEXT')})
  `;
  const found = new Set(rows.map((row) => row.sensor_id));
  return uniqueIds.filter((id) => !found.has(id));
}

export async function insertPositionReports(
  droneSerialNumber: string,
  reports: PositionReportInput[],
): Promise<PositionReportRecord[]> {
  const rows = reports.map((report) => ({
    report_id: report.reportId,
    sensor_id: report.sensorId,
    drone_serial_number: droneSerialNumber,
    recorded_at: report.recordedAt,
    latitude: report.latitude,
    longitude: report.longitude,
    altitude_ft: report.altitudeFt,
  }));

  const inserted = await sql<PositionReportRow[]>`
    INSERT INTO sensor_flight_log.position_reports ${sql(
      rows,
      'report_id',
      'sensor_id',
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

export async function listPositionReports(
  droneSerialNumber: string,
  query: PositionReportQuery,
): Promise<PositionReportRecord[]> {
  const rows = await sql<PositionReportRow[]>`
    SELECT * FROM sensor_flight_log.position_reports
    WHERE drone_serial_number = ${droneSerialNumber}
      AND (${query.from ?? null}::timestamptz IS NULL OR recorded_at >= ${query.from ?? null}::timestamptz)
      AND (${query.to ?? null}::timestamptz IS NULL OR recorded_at <= ${query.to ?? null}::timestamptz)
    ORDER BY recorded_at ASC
    LIMIT ${query.limit ?? null}
  `;
  return rows.map(mapRow);
}

export async function getLatestPositionReport(droneSerialNumber: string): Promise<PositionReportRecord | null> {
  const [row] = await sql<PositionReportRow[]>`
    SELECT * FROM sensor_flight_log.position_reports
    WHERE drone_serial_number = ${droneSerialNumber}
    ORDER BY recorded_at DESC
    LIMIT 1
  `;
  return row ? mapRow(row) : null;
}
