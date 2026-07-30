import { createRoute, z } from '@hono/zod-openapi';
import { config } from '../config';
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
} from '../repositories/wind-zones';
import { ErrorSchema } from '../schemas/common';
import {
  CreateWindReportsBodySchema,
  WindForecastCurrentQuerySchema,
  WindForecastQuerySchema,
  WindHistoryQuerySchema,
  WindLatestQuerySchema,
  WindObservedCurrentQuerySchema,
  WindReportSchema,
  WindZoneIdParamSchema,
} from '../schemas/wind-zone';

/** Router mounted at /api/v1/wind-zones. */
export const windZonesRouter = createRouter();

/** Wraps a single item in an array, passing arrays through unchanged. */
export function normalizeToArray<T>(body: T | T[]): T[] {
  return Array.isArray(body) ? body : [body];
}

/** POST /{zoneId}/observed-reports — ingest one or more observed reports for a zone. */
const ingestObservedRoute = createRoute({
  method: 'post',
  path: '/{zoneId}/observed-reports',
  request: {
    params: WindZoneIdParamSchema,
    body: { content: { 'application/json': { schema: CreateWindReportsBodySchema } } },
  },
  responses: {
    201: {
      content: { 'application/json': { schema: z.array(WindReportSchema) } },
      description: 'Accepted observed reports (newly inserted only; duplicates from idempotent retries are omitted)',
    },
  },
});

windZonesRouter.openapi(ingestObservedRoute, async (c) => {
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
    params: WindZoneIdParamSchema,
    body: { content: { 'application/json': { schema: CreateWindReportsBodySchema } } },
  },
  responses: {
    201: {
      content: { 'application/json': { schema: z.array(WindReportSchema) } },
      description: 'Accepted forecast reports (newly inserted only; duplicates from idempotent retries are omitted)',
    },
  },
});

windZonesRouter.openapi(ingestForecastRoute, async (c) => {
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
  request: { query: WindLatestQuerySchema },
  responses: {
    200: {
      content: { 'application/json': { schema: z.array(WindReportSchema) } },
      description: "Each zone's latest observed report (current picture), or as of `at` if given",
    },
  },
});

windZonesRouter.openapi(listObservedRoute, async (c) => {
  const { at } = c.req.valid('query');
  const reports = await listLatestObserved(at, config.ZONE_STALE_AFTER_MINUTES);
  return c.json(reports, 200);
});

/** GET /observed/current — zone(s) whose observed polygon contains a point. */
const observedCurrentRoute = createRoute({
  method: 'get',
  path: '/observed/current',
  request: { query: WindObservedCurrentQuerySchema },
  responses: {
    200: {
      content: { 'application/json': { schema: z.array(WindReportSchema) } },
      description: 'Zone(s) whose observed polygon contains the point, latest or as of `at`',
    },
  },
});

windZonesRouter.openapi(observedCurrentRoute, async (c) => {
  const { lat, lon, at } = c.req.valid('query');
  const reports = await listObservedCurrent(lat, lon, at, config.ZONE_STALE_AFTER_MINUTES);
  return c.json(reports, 200);
});

/** GET /forecast — each zone's forecast applicable to a required `at`. */
const listForecastRoute = createRoute({
  method: 'get',
  path: '/forecast',
  request: { query: WindForecastQuerySchema },
  responses: {
    200: {
      content: { 'application/json': { schema: z.array(WindReportSchema) } },
      description: "Each zone's forecast closest to `at`",
    },
  },
});

windZonesRouter.openapi(listForecastRoute, async (c) => {
  const { at } = c.req.valid('query');
  const reports = await listLatestForecast(at);
  return c.json(reports, 200);
});

/** GET /forecast/current — zone(s) whose forecast polygon (for a required `at`) contains a point. */
const forecastCurrentRoute = createRoute({
  method: 'get',
  path: '/forecast/current',
  request: { query: WindForecastCurrentQuerySchema },
  responses: {
    200: {
      content: { 'application/json': { schema: z.array(WindReportSchema) } },
      description: 'Zone(s) whose forecast polygon (closest to `at`) contains the point',
    },
  },
});

windZonesRouter.openapi(forecastCurrentRoute, async (c) => {
  const { lat, lon, at } = c.req.valid('query');
  const reports = await listForecastCurrent(lat, lon, at);
  return c.json(reports, 200);
});

/** GET /{zoneId}/observed-reports — a zone's observed history. */
const zoneObservedHistoryRoute = createRoute({
  method: 'get',
  path: '/{zoneId}/observed-reports',
  request: { params: WindZoneIdParamSchema, query: WindHistoryQuerySchema },
  responses: {
    200: {
      content: { 'application/json': { schema: z.array(WindReportSchema) } },
      description: "A zone's observed history, or the single report as of `at` if given",
    },
  },
});

windZonesRouter.openapi(zoneObservedHistoryRoute, async (c) => {
  const { zoneId } = c.req.valid('param');
  const query = c.req.valid('query');
  const reports = await listZoneObservedHistory(zoneId, query);
  return c.json(reports, 200);
});

/** GET /{zoneId}/observed-reports/latest — a zone's single most recent observed report. */
const zoneObservedLatestRoute = createRoute({
  method: 'get',
  path: '/{zoneId}/observed-reports/latest',
  request: { params: WindZoneIdParamSchema },
  responses: {
    200: { content: { 'application/json': { schema: WindReportSchema } }, description: 'Most recent observed report' },
    404: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'No recent observed report for this zone (unreported or dissipated)',
    },
  },
});

windZonesRouter.openapi(zoneObservedLatestRoute, async (c) => {
  const { zoneId } = c.req.valid('param');
  const report = await getZoneObservedLatest(zoneId, config.ZONE_STALE_AFTER_MINUTES);
  if (!report) return c.json({ message: `No recent observed report for zone ${zoneId}` }, 404);
  return c.json(report, 200);
});

/** GET /{zoneId}/forecast-reports — a zone's forecast history. */
const zoneForecastHistoryRoute = createRoute({
  method: 'get',
  path: '/{zoneId}/forecast-reports',
  request: { params: WindZoneIdParamSchema, query: WindHistoryQuerySchema },
  responses: {
    200: {
      content: { 'application/json': { schema: z.array(WindReportSchema) } },
      description: "A zone's forecast history, or the single forecast closest to `at` if given",
    },
  },
});

windZonesRouter.openapi(zoneForecastHistoryRoute, async (c) => {
  const { zoneId } = c.req.valid('param');
  const query = c.req.valid('query');
  const reports = await listZoneForecastHistory(zoneId, query);
  return c.json(reports, 200);
});
