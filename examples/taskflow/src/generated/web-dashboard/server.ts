/**
 * Web Dashboard — HTTP Server
 *
 * Serves the TaskFlow dashboard as a single-page web app.
 * The DashboardPage module generates the complete HTML.
 */

import { createServer, IncomingMessage, ServerResponse } from 'node:http';

import { createDashboard } from './dashboard-page.js';
import { generateCSSString } from './styles.js';
import * as analyticsPanel from './analytics-panel.js';
import * as taskListDisplay from './task-list-display.js';

// ─── Metrics ─────────────────────────────────────────────────────────────────

const _svcMetrics = {
  requests_total: 0,
  requests_by_path: {} as Record<string, number>,
  errors_total: 0,
  uptime_start: Date.now(),
};

// ─── Module Registry ─────────────────────────────────────────────────────────

const _svcModules = {
  'analytics-panel': analyticsPanel,
  'dashboard-page': { createDashboard },
  'styles': { generateCSSString },
  'task-list-display': taskListDisplay,
};

// ─── Router ──────────────────────────────────────────────────────────────────

type Handler = (req: IncomingMessage, res: ServerResponse) => void | Promise<void>;

const routes: Record<string, Handler> = {
  '/': (_req, res) => {
    const dashboard = createDashboard();
    const html = dashboard.renderHTML();
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
  },

  '/health': (_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      service: 'Web Dashboard',
      uptime: Math.floor((Date.now() - _svcMetrics.uptime_start) / 1000),
      modules: Object.keys(_svcModules),
    }));
  },

  '/metrics': (_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      ..._svcMetrics,
      uptime_seconds: Math.floor((Date.now() - _svcMetrics.uptime_start) / 1000),
    }, null, 2));
  },

  '/modules': (_req, res) => {
    const info = Object.entries(_svcModules).map(([name, mod]) => ({
      name,
      exports: Object.keys(mod),
    }));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(info, null, 2));
  },
};

// ─── Server ──────────────────────────────────────────────────────────────────

function handleRequest(req: IncomingMessage, res: ServerResponse): void {
  const url = req.url ?? '/';
  const path = url.split('?')[0];

  _svcMetrics.requests_total++;
  _svcMetrics.requests_by_path[path] = (_svcMetrics.requests_by_path[path] ?? 0) + 1;

  const handler = routes[path];
  if (handler) {
    try {
      handler(req, res);
    } catch (err) {
      _svcMetrics.errors_total++;
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: String(err) }));
    }
  } else {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      error: 'Not Found',
      path,
      available: Object.keys(routes),
    }));
  }
}

export function startServer(port?: number): { server: ReturnType<typeof createServer>; port: number; ready: Promise<void> } {
  const requestedPort = port ?? parseInt(process.env.WEB_DASHBOARD_PORT ?? process.env.PORT ?? '3002', 10);
  const server = createServer(handleRequest);
  let actualPort = requestedPort;

  const ready = new Promise<void>(resolve => {
    server.listen(requestedPort, () => {
      const addr = server.address();
      if (addr && typeof addr === 'object') actualPort = addr.port;
      result.port = actualPort;
      console.log(`TaskFlow Dashboard → http://localhost:${actualPort}`);
      resolve();
    });
  });

  const result = { server, port: actualPort, ready };
  return result;
}

// Start when run directly
const isMain = process.argv[1]?.endsWith('/web-dashboard/server.js') ||
               process.argv[1]?.endsWith('/web-dashboard/server.ts');
if (isMain) {
  startServer();
}
