import { z } from '@hono/zod-openapi';

/** Standard `{ message }` shape for API error responses. */
export const ErrorSchema = z
  .object({
    message: z.string().openapi({ example: 'Owner clh6z8h1x0000qzrm... not found' }),
  })
  .openapi('Error');
