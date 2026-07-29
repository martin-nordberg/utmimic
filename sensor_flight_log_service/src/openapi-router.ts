import { type Hook, OpenAPIHono } from '@hono/zod-openapi';

/** Replaces @hono/zod-openapi's default validation-failure response with `{ message: string }`. */
const validationErrorHook: Hook<unknown, any, string, Response | undefined> = (result, c) => {
  // By default, when a request fails Zod validation (e.g. a missing required field),
  // @hono/zod-openapi responds with { "success": false, "error": { "name": "ZodError",
  // "message": "[...]" } }, where error.message is a JSON-*stringified* array of Zod
  // issues crammed into a string. That's a different, undeclared shape from every other
  // error response in this API (404/409/500 all return `{ message: string }`, see
  // schemas/common.ts's ErrorSchema), and it's awkward for a client to parse or display.
  if (!result.success) {
    const message = result.error.issues
      .map((issue) => (issue.path.length > 0 ? `${issue.path.join('.')}: ${issue.message}` : issue.message))
      .join('; ');
    return c.json({ message }, 400);
  }
};

/** Creates an OpenAPIHono instance with the validation-error override applied. */
export function createRouter() {
  // `defaultHook` is a per-instance constructor option, and this service creates one
  // OpenAPIHono instance per route module (plus the top-level app) rather than a single
  // instance — use this function everywhere instead of `new OpenAPIHono()` so the override
  // above is guaranteed on every instance regardless of how `.route()` mounting happens to
  // propagate it.
  return new OpenAPIHono({ defaultHook: validationErrorHook });
}
