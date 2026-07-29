import { z } from '@hono/zod-openapi';

/** Standard `{ message }` shape for API error responses. */
export const ErrorSchema = z
  .object({
    message: z.string().openapi({ example: 'No positions recorded for drone FA1AAAAA00000001' }),
  })
  .openapi('Error');
