import { z } from '@hono/zod-openapi';
import { LatitudeSchema, LongitudeSchema } from './common';

/** Path param schema for routes scoped to a drone's serial number. */
export const DroneSerialParamSchema = z.object({
  serial: z.string().min(1).openapi({
    param: { name: 'serial', in: 'path' },
    example: 'FA1AAAAA00000001',
  }),
});

/** Fields shared by position report request and response schemas. */
const positionReportFields = {
  reportId: z.string().min(1).openapi({ example: 'clh6z9k9x0000qzrm' }),
  recordedAt: z.iso.datetime().openapi({ example: '2026-07-25T14:03:11.000Z' }),
  latitude: LatitudeSchema.openapi({ example: 47.6205 }),
  longitude: LongitudeSchema.openapi({ example: -122.3493 }),
  altitudeFt: z.number().openapi({ example: 412.5 }),
};

/** Request body schema for a single ingested position report. */
export const CreatePositionReportSchema = z.object(positionReportFields).openapi('CreatePositionReport');

/** Request body schema for ingesting one or many position reports. */
export const CreatePositionReportsBodySchema = z
  .union([CreatePositionReportSchema, z.array(CreatePositionReportSchema)])
  .openapi('CreatePositionReportsBody');

/** Response schema for a persisted position report. */
export const PositionReportSchema = z
  .object({
    ...positionReportFields,
    droneSerialNumber: z.string().min(1).openapi({ example: 'FA1AAAAA00000001' }),
    ingestedAt: z.iso.datetime().openapi({ example: '2026-07-25T14:03:12.500Z' }),
  })
  .openapi('PositionReport');

/** Query params for filtering/limiting position report listings. */
export const PositionQuerySchema = z.object({
  from: z.iso.datetime().optional().openapi({ example: '2026-07-25T00:00:00.000Z' }),
  to: z.iso.datetime().optional().openapi({ example: '2026-07-26T00:00:00.000Z' }),
  limit: z.coerce.number().int().positive().optional().openapi({ example: 100 }),
});
