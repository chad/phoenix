import { Hono } from 'hono';
import { logger } from 'hono/logger';
import { cors } from 'hono/cors';

const app = new Hono();

app.use('*', logger());
app.use('*', cors());

app.get('/health', (c) => c.json({ status: 'ok', uptime: process.uptime() }));

// Browsers auto-request /favicon.ico; answer 204 so it isn't a console 404.
app.get('/favicon.ico', (c) => c.body(null, 204));

app.onError((err, c) => {
  console.error('Unhandled error:', err.message, err.stack);
  return c.json({ error: err.message }, 500);
});

export function mount(path: string, router: Hono): void {
  app.route(path, router);
}

export { app };
