import { createRoute, z } from '@hono/zod-openapi';
import { createRouter } from '../openapi-router';
import {
  findMissingSensorIds,
  getLatestPositionReport,
  insertPositionReports,
  listPositionReports,
} from '../repositories/positions';
import { ErrorSchema } from '../schemas/common';
import {
  CreatePositionReportsBodySchema,
  DroneSerialParamSchema,
  PositionQuerySchema,
  PositionReportSchema,
} from '../schemas/position';

/** Router mounted at /api/v1/drones/{serial}/positions. */
export const positionsRouter = createRouter();

/** Wraps a single item in an array, passing arrays through unchanged. */
export function normalizeToArray<T>(body: T | T[]): T[] {
  return Array.isArray(body) ? body : [body];
}

/** POST / — ingest one or more position reports for a drone. */
const ingestRoute = createRoute({
  method: 'post',
  path: '/',
  request: {
    params: DroneSerialParamSchema,
    body: { content: { 'application/json': { schema: CreatePositionReportsBodySchema } } },
  },
  responses: {
    201: {
      content: { 'application/json': { schema: z.array(PositionReportSchema) } },
      description: 'Accepted position reports (newly inserted only; duplicates from idempotent retries are omitted)',
    },
    400: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Validation failed' },
    404: { content: { 'application/json': { schema: ErrorSchema } }, description: 'One or more sensorIds are unknown' },
    415: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Content-Type must be application/json' },
  },
});

positionsRouter.openapi(ingestRoute, async (c) => {
  const { serial } = c.req.valid('param');
  const reports = normalizeToArray(c.req.valid('json'));

  if (reports.length === 0) {
    return c.json([], 201);
  }

  const missingSensorIds = await findMissingSensorIds(reports.map((report) => report.sensorId));
  if (missingSensorIds.length > 0) {
    return c.json({ message: `Unknown sensorId(s): ${missingSensorIds.join(', ')}` }, 404);
  }

  const inserted = await insertPositionReports(serial, reports);
  return c.json(inserted, 201);
});

/** GET / — list a drone's position history. */
const listRoute = createRoute({
  method: 'get',
  path: '/',
  request: {
    params: DroneSerialParamSchema,
    query: PositionQuerySchema,
  },
  responses: {
    200: {
      content: { 'application/json': { schema: z.array(PositionReportSchema) } },
      description: 'Position history, ascending by recordedAt',
    },
  },
});

positionsRouter.openapi(listRoute, async (c) => {
  const { serial } = c.req.valid('param');
  const query = c.req.valid('query');
  const reports = await listPositionReports(serial, query);
  return c.json(reports, 200);
});

/** GET /latest — fetch a drone's most recent position. */
const latestRoute = createRoute({
  method: 'get',
  path: '/latest',
  request: { params: DroneSerialParamSchema },
  responses: {
    200: { content: { 'application/json': { schema: PositionReportSchema } }, description: 'Most recent position' },
    404: { content: { 'application/json': { schema: ErrorSchema } }, description: 'No positions recorded for this drone' },
  },
});

positionsRouter.openapi(latestRoute, async (c) => {
  const { serial } = c.req.valid('param');
  const report = await getLatestPositionReport(serial);
  if (!report) return c.json({ message: `No positions recorded for drone ${serial}` }, 404);
  return c.json(report, 200);
});
