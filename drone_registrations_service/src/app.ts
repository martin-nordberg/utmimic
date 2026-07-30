import { Hono } from 'hono';

/** The service's root Hono app: middleware, error handling, docs, and route mounts. */
export const app = new Hono();

app.get('/healthz', (c) => c.body(null, 200));
