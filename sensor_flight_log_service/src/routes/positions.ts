import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
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

export const positionsRouter = new OpenAPIHono();

export function normalizeToArray<T>(body: T | T[]): T[] {
  return Array.isArray(body) ? body : [body];
}

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
    404: { content: { 'application/json': { schema: ErrorSchema } }, description: 'One or more sensorIds are unknown' },
  },
});

positionsRouter.openapi(ingestRoute, async (c) => {
  const { serial } = c.req.valid('param');
  const reports = normalizeToArray(c.req.valid('json'));

  const missingSensorIds = await findMissingSensorIds(reports.map((report) => report.sensorId));
  if (missingSensorIds.length > 0) {
    return c.json({ message: `Unknown sensorId(s): ${missingSensorIds.join(', ')}` }, 404);
  }

  const inserted = await insertPositionReports(serial, reports);
  return c.json(inserted, 201);
});

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
