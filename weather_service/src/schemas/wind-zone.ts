import { z } from '@hono/zod-openapi';
import { PolygonSchema } from './geojson';

/** State of a wind zone. */
export const WindStateSchema = z.enum(['calm', 'slight_winds', 'heavy_winds', 'dangerous_winds']).openapi('WindState');

/** Path param schema for routes scoped to a wind zone's ID. */
export const WindZoneIdParamSchema = z.object({
  zoneId: z.string().min(1).openapi({
    param: { name: 'zoneId', in: 'path' },
    example: 'clh6z8h1x0000qzrm',
  }),
});

/** Fields shared by wind report request and response schemas. */
const windReportFields = {
  reportId: z.string().min(1).openapi({ example: 'clh6z9k9x0000qzrm' }),
  recordedAt: z.iso.datetime().openapi({ example: '2026-07-25T14:03:11.000Z' }),
  state: WindStateSchema.openapi({ example: 'heavy_winds' }),
  polygon: PolygonSchema,
};

/** Request body schema for a single ingested wind report. */
export const CreateWindReportSchema = z.object(windReportFields).openapi('CreateWindReport');

/** Request body schema for ingesting one or many wind reports. */
export const CreateWindReportsBodySchema = z
  .union([CreateWindReportSchema, z.array(CreateWindReportSchema)])
  .openapi('CreateWindReportsBody');

/** Response schema for a persisted wind report. */
export const WindReportSchema = z
  .object({
    ...windReportFields,
    zoneId: z.string().min(1).openapi({ example: 'clh6z8h1x0000qzrm' }),
    ingestedAt: z.iso.datetime().openapi({ example: '2026-07-25T14:03:12.500Z' }),
  })
  .openapi('WindReport');

/** Query params for the "latest per zone" observed listing — `at` is optional (omitted means true latest). */
export const WindLatestQuerySchema = z.object({
  at: z.iso.datetime().optional().openapi({ example: '2026-07-25T14:00:00.000Z' }),
});

/** Query params for a forecast listing — `at` is required, since forecasts have no "latest". */
export const WindForecastQuerySchema = z.object({
  at: z.iso.datetime().openapi({ example: '2026-07-25T18:00:00.000Z' }),
});

/** Query params identifying a point to test for polygon containment. */
export const WindCurrentQuerySchema = z.object({
  lat: z.coerce.number().openapi({ example: 47.62 }),
  lon: z.coerce.number().openapi({ example: -122.35 }),
});

/** `/observed/current` query: point-in-polygon lookup against the latest (or as-of-`at`) observed report. */
export const WindObservedCurrentQuerySchema = WindCurrentQuerySchema.extend(WindLatestQuerySchema.shape);

/** `/forecast/current` query: point-in-polygon lookup against the forecast for a required `at`. */
export const WindForecastCurrentQuerySchema = WindCurrentQuerySchema.extend(WindForecastQuerySchema.shape);

/** Query params for a zone's report history: a `from`/`to`/`limit` range, or a single `at` lookup. */
export const WindHistoryQuerySchema = z.object({
  from: z.iso.datetime().optional().openapi({ example: '2026-07-25T00:00:00.000Z' }),
  to: z.iso.datetime().optional().openapi({ example: '2026-07-26T00:00:00.000Z' }),
  limit: z.coerce.number().int().positive().optional().openapi({ example: 100 }),
  at: z.iso.datetime().optional().openapi({ example: '2026-07-25T14:00:00.000Z' }),
});
