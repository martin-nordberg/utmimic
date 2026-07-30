import { z } from '@hono/zod-openapi';
import { withSpatialFilter } from './common';
import { PolygonSchema } from './geojson';

/** State of a visibility zone. */
export const VisibilityStateSchema = z.enum(['clear', 'cloudy', 'foggy', 'rainy', 'stormy']).openapi('VisibilityState');

/** Path param schema for routes scoped to a visibility zone's ID. */
export const VisibilityZoneIdParamSchema = z.object({
  zoneId: z.string().min(1).openapi({
    param: { name: 'zoneId', in: 'path' },
    example: 'clh6z8h1x0000qzrm',
  }),
});

/** Fields shared by visibility report request and response schemas. */
const visibilityReportFields = {
  reportId: z.string().min(1).openapi({ example: 'clh6z9k9x0000qzrm' }),
  recordedAt: z.iso.datetime().openapi({ example: '2026-07-25T14:03:11.000Z' }),
  state: VisibilityStateSchema.openapi({ example: 'foggy' }),
  ceilingFt: z.number().optional().openapi({ example: 800 }),
  polygon: PolygonSchema,
};

/** Request body schema for a single ingested visibility report; `ceilingFt` is required exactly when `state` is `'foggy'`, mirroring the table's CHECK constraint. */
export const CreateVisibilityReportSchema = z
  .object(visibilityReportFields)
  .refine((report) => (report.state === 'foggy') === (report.ceilingFt !== undefined), {
    message: "ceilingFt is required when state is 'foggy', and not allowed otherwise",
    path: ['ceilingFt'],
  })
  .openapi('CreateVisibilityReport');

/** Request body schema for ingesting one or many visibility reports. */
export const CreateVisibilityReportsBodySchema = z
  .union([CreateVisibilityReportSchema, z.array(CreateVisibilityReportSchema)])
  .openapi('CreateVisibilityReportsBody');

/** Response schema for a persisted visibility report. */
export const VisibilityReportSchema = z
  .object({
    ...visibilityReportFields,
    zoneId: z.string().min(1).openapi({ example: 'clh6z8h1x0000qzrm' }),
    ingestedAt: z.iso.datetime().openapi({ example: '2026-07-25T14:03:12.500Z' }),
  })
  .openapi('VisibilityReport');

/** Query params for the "latest per zone" observed listing — `at` is optional (omitted means true latest). */
export const VisibilityLatestQuerySchema = z.object({
  at: z.iso.datetime().optional().openapi({ example: '2026-07-25T14:00:00.000Z' }),
});

/** Query params for a forecast listing — `at` is required, since forecasts have no "latest". */
export const VisibilityForecastQuerySchema = z.object({
  at: z.iso.datetime().openapi({ example: '2026-07-25T18:00:00.000Z' }),
});

/** `/observed/current` query: point-or-extent lookup (see `withSpatialFilter`) against the latest (or as-of-`at`) observed report. */
export const VisibilityObservedCurrentQuerySchema = withSpatialFilter(VisibilityLatestQuerySchema.shape);

/** `/forecast/current` query: point-or-extent lookup (see `withSpatialFilter`) against the forecast for a required `at`. */
export const VisibilityForecastCurrentQuerySchema = withSpatialFilter(VisibilityForecastQuerySchema.shape);

/** Query params for a zone's report history: a `from`/`to`/`limit` range, or a single `at` lookup. */
export const VisibilityHistoryQuerySchema = z.object({
  from: z.iso.datetime().optional().openapi({ example: '2026-07-25T00:00:00.000Z' }),
  to: z.iso.datetime().optional().openapi({ example: '2026-07-26T00:00:00.000Z' }),
  limit: z.coerce.number().int().positive().optional().openapi({ example: 100 }),
  at: z.iso.datetime().optional().openapi({ example: '2026-07-25T14:00:00.000Z' }),
});
