import { createRoute, z } from '@hono/zod-openapi';
import { config } from '../config';
import { toSpatialFilter } from '../geo';
import { createRouter } from '../openapi-router';
import {
  getZoneObservedLatest,
  insertForecastReports,
  insertObservedReports,
  listLatestForecast,
  listLatestObserved,
  listForecastCurrent,
  listObservedCurrent,
  listZoneForecastHistory,
  listZoneObservedHistory,
} from '../repositories/visibility-zones';
import { ErrorSchema } from '../schemas/common';
import {
  CreateVisibilityReportsBodySchema,
  VisibilityForecastCurrentQuerySchema,
  VisibilityForecastQuerySchema,
  VisibilityHistoryQuerySchema,
  VisibilityLatestQuerySchema,
  VisibilityObservedCurrentQuerySchema,
  VisibilityReportSchema,
  VisibilityZoneIdParamSchema,
} from '../schemas/visibility-zone';

/** Router mounted at /api/v1/visibility-zones. */
export const visibilityZonesRouter = createRouter();

/** Wraps a single item in an array, passing arrays through unchanged. */
export function normalizeToArray<T>(body: T | T[]): T[] {
  return Array.isArray(body) ? body : [body];
}

/** POST /{zoneId}/observed-reports — ingest one or more observed reports for a zone. */
const ingestObservedRoute = createRoute({
  method: 'post',
  path: '/{zoneId}/observed-reports',
  request: {
    params: VisibilityZoneIdParamSchema,
    body: { content: { 'application/json': { schema: CreateVisibilityReportsBodySchema } } },
  },
  responses: {
    201: {
      content: { 'application/json': { schema: z.array(VisibilityReportSchema) } },
      description: 'Accepted observed reports (newly inserted only; duplicates from idempotent retries are omitted)',
    },
  },
});

visibilityZonesRouter.openapi(ingestObservedRoute, async (c) => {
  const { zoneId } = c.req.valid('param');
  const reports = normalizeToArray(c.req.valid('json'));

  if (reports.length === 0) {
    return c.json([], 201);
  }

  const inserted = await insertObservedReports(zoneId, reports);
  return c.json(inserted, 201);
});

/** POST /{zoneId}/forecast-reports — ingest one or more forecast reports for a zone. */
const ingestForecastRoute = createRoute({
  method: 'post',
  path: '/{zoneId}/forecast-reports',
  request: {
    params: VisibilityZoneIdParamSchema,
    body: { content: { 'application/json': { schema: CreateVisibilityReportsBodySchema } } },
  },
  responses: {
    201: {
      content: { 'application/json': { schema: z.array(VisibilityReportSchema) } },
      description: 'Accepted forecast reports (newly inserted only; duplicates from idempotent retries are omitted)',
    },
  },
});

visibilityZonesRouter.openapi(ingestForecastRoute, async (c) => {
  const { zoneId } = c.req.valid('param');
  const reports = normalizeToArray(c.req.valid('json'));

  if (reports.length === 0) {
    return c.json([], 201);
  }

  const inserted = await insertForecastReports(zoneId, reports);
  return c.json(inserted, 201);
});

/** GET /observed — latest observed report per zone, or as of `at` if given. */
const listObservedRoute = createRoute({
  method: 'get',
  path: '/observed',
  request: { query: VisibilityLatestQuerySchema },
  responses: {
    200: {
      content: { 'application/json': { schema: z.array(VisibilityReportSchema) } },
      description: "Each zone's latest observed report (current picture), or as of `at` if given",
    },
  },
});

visibilityZonesRouter.openapi(listObservedRoute, async (c) => {
  const { at } = c.req.valid('query');
  const reports = await listLatestObserved(at, config.ZONE_STALE_AFTER_MINUTES);
  return c.json(reports, 200);
});

/** GET /observed/current — zone(s) whose observed polygon contains a point or intersects an extent. */
const observedCurrentRoute = createRoute({
  method: 'get',
  path: '/observed/current',
  request: { query: VisibilityObservedCurrentQuerySchema },
  responses: {
    200: {
      content: { 'application/json': { schema: z.array(VisibilityReportSchema) } },
      description: 'Zone(s) whose observed polygon contains the point or intersects the extent, latest or as of `at`',
    },
  },
});

visibilityZonesRouter.openapi(observedCurrentRoute, async (c) => {
  const { at, ...query } = c.req.valid('query');
  const reports = await listObservedCurrent(toSpatialFilter(query), at, config.ZONE_STALE_AFTER_MINUTES);
  return c.json(reports, 200);
});

/** GET /forecast — each zone's forecast applicable to a required `at`. */
const listForecastRoute = createRoute({
  method: 'get',
  path: '/forecast',
  request: { query: VisibilityForecastQuerySchema },
  responses: {
    200: {
      content: { 'application/json': { schema: z.array(VisibilityReportSchema) } },
      description: "Each zone's forecast closest to `at`",
    },
  },
});

visibilityZonesRouter.openapi(listForecastRoute, async (c) => {
  const { at } = c.req.valid('query');
  const reports = await listLatestForecast(at);
  return c.json(reports, 200);
});

/** GET /forecast/current — zone(s) whose forecast polygon (for a required `at`) contains a point or intersects an extent. */
const forecastCurrentRoute = createRoute({
  method: 'get',
  path: '/forecast/current',
  request: { query: VisibilityForecastCurrentQuerySchema },
  responses: {
    200: {
      content: { 'application/json': { schema: z.array(VisibilityReportSchema) } },
      description: 'Zone(s) whose forecast polygon (closest to `at`) contains the point or intersects the extent',
    },
  },
});

visibilityZonesRouter.openapi(forecastCurrentRoute, async (c) => {
  const { at, ...query } = c.req.valid('query');
  const reports = await listForecastCurrent(toSpatialFilter(query), at);
  return c.json(reports, 200);
});

/** GET /{zoneId}/observed-reports — a zone's observed history. */
const zoneObservedHistoryRoute = createRoute({
  method: 'get',
  path: '/{zoneId}/observed-reports',
  request: { params: VisibilityZoneIdParamSchema, query: VisibilityHistoryQuerySchema },
  responses: {
    200: {
      content: { 'application/json': { schema: z.array(VisibilityReportSchema) } },
      description: "A zone's observed history, or the single report as of `at` if given",
    },
  },
});

visibilityZonesRouter.openapi(zoneObservedHistoryRoute, async (c) => {
  const { zoneId } = c.req.valid('param');
  const query = c.req.valid('query');
  const reports = await listZoneObservedHistory(zoneId, query);
  return c.json(reports, 200);
});

/** GET /{zoneId}/observed-reports/latest — a zone's single most recent observed report. */
const zoneObservedLatestRoute = createRoute({
  method: 'get',
  path: '/{zoneId}/observed-reports/latest',
  request: { params: VisibilityZoneIdParamSchema },
  responses: {
    200: { content: { 'application/json': { schema: VisibilityReportSchema } }, description: 'Most recent observed report' },
    404: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'No recent observed report for this zone (unreported or dissipated)',
    },
  },
});

visibilityZonesRouter.openapi(zoneObservedLatestRoute, async (c) => {
  const { zoneId } = c.req.valid('param');
  const report = await getZoneObservedLatest(zoneId, config.ZONE_STALE_AFTER_MINUTES);
  if (!report) return c.json({ message: `No recent observed report for zone ${zoneId}` }, 404);
  return c.json(report, 200);
});

/** GET /{zoneId}/forecast-reports — a zone's forecast history. */
const zoneForecastHistoryRoute = createRoute({
  method: 'get',
  path: '/{zoneId}/forecast-reports',
  request: { params: VisibilityZoneIdParamSchema, query: VisibilityHistoryQuerySchema },
  responses: {
    200: {
      content: { 'application/json': { schema: z.array(VisibilityReportSchema) } },
      description: "A zone's forecast history, or the single forecast closest to `at` if given",
    },
  },
});

visibilityZonesRouter.openapi(zoneForecastHistoryRoute, async (c) => {
  const { zoneId } = c.req.valid('param');
  const query = c.req.valid('query');
  const reports = await listZoneForecastHistory(zoneId, query);
  return c.json(reports, 200);
});
