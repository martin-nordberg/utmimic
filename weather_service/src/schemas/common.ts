import { z } from '@hono/zod-openapi';

/** Standard `{ message }` shape for API error responses. */
export const ErrorSchema = z
  .object({
    message: z.string().openapi({ example: 'No observed reports for zone clh6z8h1x0000qzrm...' }),
  })
  .openapi('Error');
