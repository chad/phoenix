/**
 * Scaffold Generator — produces the runnable service shell around generated modules.
 *
 * Generates:
 * - Per-service index.ts (barrel re-exports)
 * - Per-service server.ts (HTTP server with health + metrics)
 * - Per-service test file
 * - Root index.ts (service registry)
 * - Project package.json and tsconfig.json
 */

import type { ImplementationUnit } from './models/iu.js';
import type { CanonicalNode } from './models/canonical.js';
import type { ResolvedTarget } from './models/architecture.js';
import { sha256 } from './semhash.js';

export interface ServiceDescriptor {
  /** Service name, e.g. "api-gateway" */
  name: string;
  /** Directory under src/generated/, e.g. "api-gateway" */
  dir: string;
  /** Module file names (without path prefix), e.g. ["authentication.ts", "rate-limiting.ts"] */
  modules: string[];
  /** The IUs belonging to this service */
  ius: ImplementationUnit[];
  /** Default port for this service */
  port: number;
}

export interface ScaffoldResult {
  files: Map<string, string>;  // path → content
}

/**
 * Interface entry — a single source of truth for how an IU is exposed
 * at the architecture level. Computed by the architecture from the IU plan
 * and canonical nodes.
 *
 * Covers mount paths and resource field descriptions. Full response schemas
 * (exact field types, validation rules) are not yet included — they are
 * generated independently per IU and could still diverge.
 */
export interface InterfaceEntry {
  iu_id: string;
  name: string;
  mount_path: string;
  role: 'api' | 'web-ui';
  /** Resource field description extracted from canonical nodes (e.g., "a name and a color"). */
  resource_fields: string;
}

/**
 * Derive the interface registry from the IU plan and canonical nodes.
 * This is the single source of truth for mount paths and resource shapes —
 * both scaffold generation and LLM prompt building must use this.
 */
export function deriveInterfaces(
  ius: ImplementationUnit[],
  canonNodes?: CanonicalNode[],
): InterfaceEntry[] {
  return ius.map(iu => {
    const lowerName = iu.name.toLowerCase();
    const isWebUI = /\b(web|ui|frontend|interface|page|dashboard)\b/.test(lowerName);
    return {
      iu_id: iu.iu_id,
      name: iu.name,
      mount_path: isWebUI ? '' : '/' + lowerName.replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, ''),
      role: isWebUI ? 'web-ui' as const : 'api' as const,
      resource_fields: extractResourceFields(iu, canonNodes),
    };
  });
}

/**
 * Extract resource field descriptions from canonical nodes for an IU.
 * Looks for "has/have" statements in CONTEXT/DEFINITION nodes that mention
 * the IU's resource name (e.g., "a project has a name and a color" for the Projects IU).
 * Checks both IU-owned nodes and orphan nodes that match by resource name,
 * since the IU planner may not assign CONTEXT nodes describing resource shape.
 */
function extractResourceFields(iu: ImplementationUnit, canonNodes?: CanonicalNode[]): string {
  if (!canonNodes) return '';
  // Derive a singular resource name from the IU name: "Projects" → "project", "Tasks" → "task"
  const resourceName = iu.name.toLowerCase().replace(/s$/, '');
  const matches = canonNodes.filter(n =>
    (n.type === 'CONTEXT' || n.type === 'DEFINITION') &&
    /\bhas\b|\bhave\b/i.test(n.statement) &&
    n.statement.toLowerCase().includes(resourceName)
  );
  return matches.map(n => n.statement).join('; ');
}

/**
 * Derive service descriptors from the IU plan.
 */
export function deriveServices(ius: ImplementationUnit[]): ServiceDescriptor[] {
  const serviceMap = new Map<string, ServiceDescriptor>();
  let nextPort = 3000;

  for (const iu of ius) {
    for (const outputFile of iu.output_files) {
      // outputFile is like "src/generated/api-gateway/authentication.ts"
      const parts = outputFile.replace('src/generated/', '').split('/');
      if (parts.length < 2) continue;

      const dir = parts[0];
      const moduleFile = parts.slice(1).join('/');

      let svc = serviceMap.get(dir);
      if (!svc) {
        svc = {
          name: dirToName(dir),
          dir,
          modules: [],
          ius: [],
          port: nextPort++,
        };
        serviceMap.set(dir, svc);
      }
      svc.modules.push(moduleFile);
      svc.ius.push(iu);
    }
  }

  return [...serviceMap.values()].sort((a, b) => a.dir.localeCompare(b.dir));
}

/**
 * Generate all scaffold files.
 */
export function generateScaffold(
  services: ServiceDescriptor[],
  projectName: string = 'phoenix-project',
  target?: ResolvedTarget | null,
  interfaces?: InterfaceEntry[],
): ScaffoldResult {
  const files = new Map<string, string>();

  // Architecture shared files (db.ts, app.ts, etc.)
  if (target) {
    const arch = target.architecture;
    const rt = target.runtime;
    for (const [path, content] of Object.entries(rt.sharedFiles)) {
      files.set(path, content);
    }

    // Generate architecture-specific server entry point that mounts all generated modules
    const routeImports: string[] = [];
    const routeMounts: string[] = [];
    for (const svc of services) {
      for (let i = 0; i < svc.modules.length; i++) {
        const mod = svc.modules[i];
        const iu = svc.ius[i];
        const modName = mod.replace('.ts', '').replace(/-/g, '_').replace(/[^a-zA-Z0-9_]/g, '_');
        const importPath = `./generated/${svc.dir}/${mod.replace('.ts', '.js')}`;
        routeImports.push(`import ${modName} from '${importPath}';`);
        // Look up mount path from interface registry (single source of truth)
        const entry = interfaces?.find(e => e.iu_id === iu?.iu_id);
        const prefix = entry?.mount_path ?? '';
        routeMounts.push(`mount('${prefix}', ${modName});`);
      }
    }

    const serverContent = [
      `import { serve } from '@hono/node-server';`,
      `import { app, mount } from './app.js';`,
      `import { runMigrations } from './db.js';`,
      ``,
      `// Generated route modules`,
      ...routeImports,
      ``,
      `// Mount routes`,
      ...routeMounts,
      ``,
      `const port = parseInt(process.env.PORT ?? '3000', 10);`,
      `runMigrations();`,
      `console.log(\`Server running at http://localhost:\${port}\`);`,
      `serve({ fetch: app.fetch, port });`,
      ``,
    ].join('\n');

    files.set('src/server.ts', serverContent);
  }

  for (const svc of services) {
    // Service barrel index
    files.set(
      `src/generated/${svc.dir}/index.ts`,
      generateServiceIndex(svc),
    );

    if (!target) {
      // Only generate per-service servers when no architecture is set
      files.set(
        `src/generated/${svc.dir}/server.ts`,
        generateServiceServer(svc),
      );
    }

    // Service tests
    files.set(
      `src/generated/${svc.dir}/__tests__/${svc.dir}.test.ts`,
      target ? generateArchTests(svc) : generateServiceTests(svc),
    );
  }

  // Root index
  files.set('src/generated/index.ts', generateRootIndex(services));

  // Project config
  files.set('package.json', generatePackageJson(services, projectName, target));
  files.set('tsconfig.json', generateTsConfig());
  files.set('vitest.config.ts', generateVitestConfig());

  return { files };
}

/**
 * Generate tests for architecture-based services.
 */
function generateArchTests(svc: ServiceDescriptor): string {
  const lines: string[] = [];
  lines.push(`/**`);
  lines.push(` * ${svc.name} — Generated Tests`);
  lines.push(` * AUTO-GENERATED by Phoenix VCS`);
  lines.push(` */`);
  lines.push(``);
  lines.push(`import { describe, it, expect } from 'vitest';`);

  for (const mod of svc.modules) {
    const importName = mod.replace('.ts', '').replace(/-/g, '_');
    lines.push(`import ${importName} from '../${mod.replace('.ts', '.js')}';`);
  }

  lines.push(``);
  lines.push(`describe('${svc.name} modules', () => {`);

  for (const mod of svc.modules) {
    const importName = mod.replace('.ts', '').replace(/-/g, '_');
    const displayName = mod.replace('.ts', '').replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    lines.push(`  describe('${displayName}', () => {`);
    lines.push(`    it('exports a Hono router as default', () => {`);
    lines.push(`      expect(${importName}).toBeDefined();`);
    lines.push(`      expect(typeof ${importName}.fetch).toBe('function');`);
    lines.push(`    });`);
    lines.push(`  });`);
  }

  lines.push(`});`);
  lines.push(``);
  return lines.join('\n');
}

// ─── Service Index ───────────────────────────────────────────────────────────

function generateServiceIndex(svc: ServiceDescriptor): string {
  const lines: string[] = [];

  lines.push(`/**`);
  lines.push(` * ${svc.name}`);
  lines.push(` *`);
  lines.push(` * AUTO-GENERATED by Phoenix VCS`);
  lines.push(` * Barrel export for all ${svc.name} modules.`);
  lines.push(` */`);
  lines.push('');

  for (const mod of svc.modules) {
    const modName = mod.replace(/\.ts$/, '');
    const importName = toCamelCase(modName);
    lines.push(`export * as ${importName} from './${modName}.js';`);
  }
  lines.push('');

  return lines.join('\n');
}

// ─── Web Client Detection ────────────────────────────────────────────────────

const WEB_HINTS = ['ui', 'client', 'frontend', 'web', 'page', 'view', 'html', 'css', 'style', 'lobby', 'dashboard', 'display'];

/**
 * Detect whether a service is a web client (should serve HTML).
 * Heuristic: service dir or module names contain web-related terms.
 */
function isWebClient(svc: ServiceDescriptor): boolean {
  const dirWords = svc.dir.toLowerCase().split('-');
  if (dirWords.some(w => WEB_HINTS.includes(w))) return true;

  const moduleWords = svc.modules.flatMap(m => m.replace(/\.ts$/, '').toLowerCase().split('-'));
  const webModuleCount = moduleWords.filter(w => WEB_HINTS.includes(w)).length;
  return webModuleCount >= 2;
}

// ─── Service Server ──────────────────────────────────────────────────────────

function generateServiceServer(svc: ServiceDescriptor): string {
  if (isWebClient(svc)) {
    return generateWebClientServer(svc);
  }
  return generateApiServer(svc);
}

function generateApiServer(svc: ServiceDescriptor): string {
  const lines: string[] = [];
  const portVar = `${svc.dir.toUpperCase().replace(/-/g, '_')}_PORT`;

  lines.push(`/**`);
  lines.push(` * ${svc.name} — HTTP Server`);
  lines.push(` *`);
  lines.push(` * AUTO-GENERATED by Phoenix VCS`);
  lines.push(` * Provides health check, metrics, and module endpoints.`);
  lines.push(` */`);
  lines.push('');
  lines.push(`import { createServer, IncomingMessage, ServerResponse } from 'node:http';`);
  lines.push('');

  // Import modules
  for (const mod of svc.modules) {
    const modName = mod.replace(/\.ts$/, '');
    const importName = toCamelCase(modName);
    lines.push(`import * as ${importName} from './${modName}.js';`);
  }
  lines.push('');

  // Metrics tracking
  lines.push(`// ─── Metrics ─────────────────────────────────────────────────────────────────`);
  lines.push('');
  lines.push(`const _svcMetrics = {`);
  lines.push(`  requests_total: 0,`);
  lines.push(`  requests_by_path: {} as Record<string, number>,`);
  lines.push(`  errors_total: 0,`);
  lines.push(`  uptime_start: Date.now(),`);
  lines.push(`};`);
  lines.push('');

  // Module registry
  lines.push(`// ─── Module Registry ─────────────────────────────────────────────────────────`);
  lines.push('');
  lines.push(`const _svcModules = {`);
  for (const mod of svc.modules) {
    const modName = mod.replace(/\.ts$/, '');
    const importName = toCamelCase(modName);
    lines.push(`  '${modName}': ${importName},`);
  }
  lines.push(`};`);
  lines.push('');

  // Router
  lines.push(`// ─── Router ──────────────────────────────────────────────────────────────────`);
  lines.push('');
  lines.push(`type Handler = (req: IncomingMessage, res: ServerResponse) => void | Promise<void>;`);
  lines.push('');
  lines.push(`const routes: Record<string, Handler> = {`);
  lines.push(`  '/health': (_req, res) => {`);
  lines.push(`    res.writeHead(200, { 'Content-Type': 'application/json' });`);
  lines.push(`    res.end(JSON.stringify({`);
  lines.push(`      status: 'ok',`);
  lines.push(`      service: '${svc.name}',`);
  lines.push(`      uptime: Math.floor((Date.now() - _svcMetrics.uptime_start) / 1000),`);
  lines.push(`      modules: Object.keys(_svcModules),`);
  lines.push(`    }));`);
  lines.push(`  },`);
  lines.push('');
  lines.push(`  '/metrics': (_req, res) => {`);
  lines.push(`    res.writeHead(200, { 'Content-Type': 'application/json' });`);
  lines.push(`    res.end(JSON.stringify({`);
  lines.push(`      ..._svcMetrics,`);
  lines.push(`      uptime_seconds: Math.floor((Date.now() - _svcMetrics.uptime_start) / 1000),`);
  lines.push(`    }, null, 2));`);
  lines.push(`  },`);
  lines.push('');
  lines.push(`  '/modules': (_req, res) => {`);
  lines.push(`    const info = Object.entries(_svcModules).map(([name, mod]) => {`);
  lines.push(`      const phoenix = (mod as Record<string, unknown>)._phoenix as Record<string, unknown> | undefined;`);
  lines.push(`      return {`);
  lines.push(`        name,`);
  lines.push(`        risk_tier: phoenix?.risk_tier ?? 'unknown',`);
  lines.push(`        exports: Object.keys(mod).filter(k => k !== '_phoenix'),`);
  lines.push(`      };`);
  lines.push(`    });`);
  lines.push(`    res.writeHead(200, { 'Content-Type': 'application/json' });`);
  lines.push(`    res.end(JSON.stringify(info, null, 2));`);
  lines.push(`  },`);
  lines.push(`};`);
  lines.push('');

  // Server factory
  lines.push(`// ─── Server ──────────────────────────────────────────────────────────────────`);
  lines.push('');
  lines.push(`function handleRequest(req: IncomingMessage, res: ServerResponse): void {`);
  lines.push(`  const url = req.url ?? '/';`);
  lines.push(`  const path = url.split('?')[0];`);
  lines.push('');
  lines.push(`  _svcMetrics.requests_total++;`);
  lines.push(`  _svcMetrics.requests_by_path[path] = (_svcMetrics.requests_by_path[path] ?? 0) + 1;`);
  lines.push('');
  lines.push(`  const handler = routes[path];`);
  lines.push(`  if (handler) {`);
  lines.push(`    try {`);
  lines.push(`      handler(req, res);`);
  lines.push(`    } catch (err) {`);
  lines.push(`      _svcMetrics.errors_total++;`);
  lines.push(`      res.writeHead(500, { 'Content-Type': 'application/json' });`);
  lines.push(`      res.end(JSON.stringify({ error: String(err) }));`);
  lines.push(`    }`);
  lines.push(`  } else {`);
  lines.push(`    res.writeHead(404, { 'Content-Type': 'application/json' });`);
  lines.push(`    res.end(JSON.stringify({`);
  lines.push(`      error: 'Not Found',`);
  lines.push(`      path,`);
  lines.push(`      available: Object.keys(routes),`);
  lines.push(`    }));`);
  lines.push(`  }`);
  lines.push(`}`);
  lines.push('');

  lines.push(`export function startServer(port?: number): { server: ReturnType<typeof createServer>; port: number; ready: Promise<void> } {`);
  lines.push(`  const requestedPort = port ?? parseInt(process.env.${portVar} ?? process.env.PORT ?? '${svc.port}', 10);`);
  lines.push(`  const server = createServer(handleRequest);`);
  lines.push(`  let actualPort = requestedPort;`);
  lines.push('');
  lines.push(`  const ready = new Promise<void>(resolve => {`);
  lines.push(`    server.listen(requestedPort, () => {`);
  lines.push(`      const addr = server.address();`);
  lines.push(`      if (addr && typeof addr === 'object') actualPort = addr.port;`);
  lines.push(`      result.port = actualPort;`);
  lines.push(`      console.log(\`${svc.name} listening on http://localhost:\${actualPort}\`);`);
  lines.push(`      console.log(\`  /health   — health check\`);`);
  lines.push(`      console.log(\`  /metrics  — request metrics\`);`);
  lines.push(`      console.log(\`  /modules  — registered modules\`);`);
  lines.push(`      resolve();`);
  lines.push(`    });`);
  lines.push(`  });`);
  lines.push('');
  lines.push(`  const result = { server, port: actualPort, ready };`);
  lines.push(`  return result;`);
  lines.push(`}`);
  lines.push('');

  // Main
  lines.push(`// Start when run directly`);
  lines.push(`const isMain = process.argv[1]?.endsWith('/${svc.dir}/server.js') ||`);
  lines.push(`               process.argv[1]?.endsWith('/${svc.dir}/server.ts');`);
  lines.push(`if (isMain) {`);
  lines.push(`  startServer();`);
  lines.push(`}`);
  lines.push('');

  return lines.join('\n');
}

// ─── Web Client Server ──────────────────────────────────────────────────────

function generateWebClientServer(svc: ServiceDescriptor): string {
  const portVar = `${svc.dir.toUpperCase().replace(/-/g, '_')}_PORT`;

  // Categorize modules by role
  const styleModules = svc.modules.filter(m => /styl/i.test(m) || /css/i.test(m) || /theme/i.test(m));
  const uiModules = svc.modules.filter(m => !styleModules.includes(m));

  const imports = svc.modules.map(mod => {
    const modName = mod.replace(/\.ts$/, '');
    const importName = toCamelCase(modName);
    return { modName, importName };
  });

  const lines: string[] = [];

  lines.push(`/**`);
  lines.push(` * ${svc.name} — Web Server`);
  lines.push(` *`);
  lines.push(` * AUTO-GENERATED by Phoenix VCS`);
  lines.push(` * Serves the web client HTML, plus health/metrics/modules endpoints.`);
  lines.push(` */`);
  lines.push('');
  lines.push(`import { createServer, IncomingMessage, ServerResponse } from 'node:http';`);
  lines.push('');

  for (const { modName, importName } of imports) {
    lines.push(`import * as ${importName} from './${modName}.js';`);
  }
  lines.push('');

  // Metrics
  lines.push(`// ─── Metrics ─────────────────────────────────────────────────────────────────`);
  lines.push('');
  lines.push(`const _svcMetrics = {`);
  lines.push(`  requests_total: 0,`);
  lines.push(`  requests_by_path: {} as Record<string, number>,`);
  lines.push(`  errors_total: 0,`);
  lines.push(`  uptime_start: Date.now(),`);
  lines.push(`};`);
  lines.push('');

  // Module registry
  lines.push(`// ─── Module Registry ─────────────────────────────────────────────────────────`);
  lines.push('');
  lines.push(`const _svcModules = {`);
  for (const { modName, importName } of imports) {
    lines.push(`  '${modName}': ${importName},`);
  }
  lines.push(`};`);
  lines.push('');

  // HTML renderer
  lines.push(`// ─── HTML Renderer ───────────────────────────────────────────────────────────`);
  lines.push('');
  lines.push(`function renderPage(): string {`);
  lines.push(`  // Collect CSS from style modules`);
  lines.push(`  let css = '';`);

  for (const mod of styleModules) {
    const importName = toCamelCase(mod.replace(/\.ts$/, ''));
    // Try common patterns: generateCSS(), getCSS(), css, styles
    lines.push(`  try {`);
    lines.push(`    const styleMod = ${importName} as Record<string, unknown>;`);
    lines.push(`    for (const key of Object.keys(styleMod)) {`);
    lines.push(`      const val = styleMod[key];`);
    lines.push(`      if (typeof val === 'function' && /css|style/i.test(key)) {`);
    lines.push(`        const result = (val as Function)();`);
    lines.push(`        if (typeof result === 'string') css += result;`);
    lines.push(`        else if (result && typeof result === 'object' && 'generateCSS' in result) {`);
    lines.push(`          css += (result as { generateCSS: () => string }).generateCSS();`);
    lines.push(`        }`);
    lines.push(`      }`);
    lines.push(`    }`);
    lines.push(`  } catch { /* style module may not have expected exports */ }`);
  }

  if (styleModules.length === 0) {
    lines.push(`  css = 'body { font-family: system-ui, sans-serif; margin: 2rem; }';`);
  }
  lines.push('');

  lines.push(`  // Collect HTML from UI modules`);
  lines.push(`  const sections: string[] = [];`);

  for (const mod of uiModules) {
    const importName = toCamelCase(mod.replace(/\.ts$/, ''));
    const displayName = mod.replace(/\.ts$/, '').split('-').map((w: string) => w[0].toUpperCase() + w.slice(1)).join(' ');
    lines.push(`  try {`);
    lines.push(`    const uiMod = ${importName} as Record<string, unknown>;`);
    lines.push(`    for (const key of Object.keys(uiMod)) {`);
    lines.push(`      const val = uiMod[key];`);
    lines.push(`      // Look for factory functions that return objects with render/renderHTML`);
    lines.push(`      if (typeof val === 'function' && /^create|^make|^render|^build/i.test(key)) {`);
    lines.push(`        try {`);
    lines.push(`          const instance = (val as Function)();`);
    lines.push(`          if (typeof instance === 'string' && instance.includes('<')) {`);
    lines.push(`            sections.push(instance);`);
    lines.push(`          } else if (instance && typeof instance === 'object') {`);
    lines.push(`            const obj = instance as Record<string, unknown>;`);
    lines.push(`            if (typeof obj.render === 'function') {`);
    lines.push(`              const html = (obj.render as Function)();`);
    lines.push(`              if (typeof html === 'string') sections.push(html);`);
    lines.push(`            } else if (typeof obj.renderHTML === 'function') {`);
    lines.push(`              const html = (obj.renderHTML as Function)();`);
    lines.push(`              if (typeof html === 'string') sections.push(html);`);
    lines.push(`            }`);
    lines.push(`          }`);
    lines.push(`        } catch { /* factory may require args */ }`);
    lines.push(`      }`);
    lines.push(`    }`);
    lines.push(`  } catch { /* module may not have renderable exports */ }`);
  }
  lines.push('');

  lines.push(`  return \`<!DOCTYPE html>`);
  lines.push(`<html lang="en">`);
  lines.push(`<head>`);
  lines.push(`  <meta charset="utf-8">`);
  lines.push(`  <meta name="viewport" content="width=device-width, initial-scale=1">`);
  lines.push(`  <title>${svc.name}</title>`);
  lines.push(`  <style>\${css}</style>`);
  lines.push(`</head>`);
  lines.push(`<body>`);
  lines.push(`  <div class="game-container">`);
  lines.push(`    \${sections.join('\\n')}`);
  lines.push(`  </div>`);
  lines.push(`</body>`);
  lines.push(`</html>\`;`);
  lines.push(`}`);
  lines.push('');

  // Router
  lines.push(`// ─── Router ──────────────────────────────────────────────────────────────────`);
  lines.push('');
  lines.push(`type Handler = (req: IncomingMessage, res: ServerResponse) => void | Promise<void>;`);
  lines.push('');
  lines.push(`const routes: Record<string, Handler> = {`);

  // HTML index
  lines.push(`  '/': (_req, res) => {`);
  lines.push(`    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });`);
  lines.push(`    res.end(renderPage());`);
  lines.push(`  },`);
  lines.push('');

  // Health
  lines.push(`  '/health': (_req, res) => {`);
  lines.push(`    res.writeHead(200, { 'Content-Type': 'application/json' });`);
  lines.push(`    res.end(JSON.stringify({`);
  lines.push(`      status: 'ok',`);
  lines.push(`      service: '${svc.name}',`);
  lines.push(`      uptime: Math.floor((Date.now() - _svcMetrics.uptime_start) / 1000),`);
  lines.push(`      modules: Object.keys(_svcModules),`);
  lines.push(`    }));`);
  lines.push(`  },`);
  lines.push('');
  lines.push(`  '/metrics': (_req, res) => {`);
  lines.push(`    res.writeHead(200, { 'Content-Type': 'application/json' });`);
  lines.push(`    res.end(JSON.stringify({`);
  lines.push(`      ..._svcMetrics,`);
  lines.push(`      uptime_seconds: Math.floor((Date.now() - _svcMetrics.uptime_start) / 1000),`);
  lines.push(`    }, null, 2));`);
  lines.push(`  },`);
  lines.push('');
  lines.push(`  '/modules': (_req, res) => {`);
  lines.push(`    const info = Object.entries(_svcModules).map(([name, mod]) => {`);
  lines.push(`      const phoenix = (mod as Record<string, unknown>)._phoenix as Record<string, unknown> | undefined;`);
  lines.push(`      return {`);
  lines.push(`        name,`);
  lines.push(`        risk_tier: phoenix?.risk_tier ?? 'unknown',`);
  lines.push(`        exports: Object.keys(mod).filter(k => k !== '_phoenix'),`);
  lines.push(`      };`);
  lines.push(`    });`);
  lines.push(`    res.writeHead(200, { 'Content-Type': 'application/json' });`);
  lines.push(`    res.end(JSON.stringify(info, null, 2));`);
  lines.push(`  },`);
  lines.push(`};`);
  lines.push('');

  // Server factory
  lines.push(`// ─── Server ──────────────────────────────────────────────────────────────────`);
  lines.push('');
  lines.push(`function handleRequest(req: IncomingMessage, res: ServerResponse): void {`);
  lines.push(`  const url = req.url ?? '/';`);
  lines.push(`  const path = url.split('?')[0];`);
  lines.push('');
  lines.push(`  _svcMetrics.requests_total++;`);
  lines.push(`  _svcMetrics.requests_by_path[path] = (_svcMetrics.requests_by_path[path] ?? 0) + 1;`);
  lines.push('');
  lines.push(`  const handler = routes[path];`);
  lines.push(`  if (handler) {`);
  lines.push(`    try {`);
  lines.push(`      handler(req, res);`);
  lines.push(`    } catch (err) {`);
  lines.push(`      _svcMetrics.errors_total++;`);
  lines.push(`      res.writeHead(500, { 'Content-Type': 'application/json' });`);
  lines.push(`      res.end(JSON.stringify({ error: String(err) }));`);
  lines.push(`    }`);
  lines.push(`  } else {`);
  lines.push(`    res.writeHead(404, { 'Content-Type': 'application/json' });`);
  lines.push(`    res.end(JSON.stringify({`);
  lines.push(`      error: 'Not Found',`);
  lines.push(`      path,`);
  lines.push(`      available: Object.keys(routes),`);
  lines.push(`    }));`);
  lines.push(`  }`);
  lines.push(`}`);
  lines.push('');

  lines.push(`export function startServer(port?: number): { server: ReturnType<typeof createServer>; port: number; ready: Promise<void> } {`);
  lines.push(`  const requestedPort = port ?? parseInt(process.env.${portVar} ?? process.env.PORT ?? '${svc.port}', 10);`);
  lines.push(`  const server = createServer(handleRequest);`);
  lines.push(`  let actualPort = requestedPort;`);
  lines.push('');
  lines.push(`  const ready = new Promise<void>(resolve => {`);
  lines.push(`    server.listen(requestedPort, () => {`);
  lines.push(`      const addr = server.address();`);
  lines.push(`      if (addr && typeof addr === 'object') actualPort = addr.port;`);
  lines.push(`      result.port = actualPort;`);
  lines.push(`      console.log(\`${svc.name} listening on http://localhost:\${actualPort}\`);`);
  lines.push(`      console.log(\`  /         — web client\`);`);
  lines.push(`      console.log(\`  /health   — health check\`);`);
  lines.push(`      console.log(\`  /metrics  — request metrics\`);`);
  lines.push(`      console.log(\`  /modules  — registered modules\`);`);
  lines.push(`      resolve();`);
  lines.push(`    });`);
  lines.push(`  });`);
  lines.push('');
  lines.push(`  const result = { server, port: actualPort, ready };`);
  lines.push(`  return result;`);
  lines.push(`}`);
  lines.push('');

  // Main
  lines.push(`// Start when run directly`);
  lines.push(`const isMain = process.argv[1]?.endsWith('/${svc.dir}/server.js') ||`);
  lines.push(`               process.argv[1]?.endsWith('/${svc.dir}/server.ts');`);
  lines.push(`if (isMain) {`);
  lines.push(`  startServer();`);
  lines.push(`}`);
  lines.push('');

  return lines.join('\n');
}

// ─── Service Tests ───────────────────────────────────────────────────────────

function generateServiceTests(svc: ServiceDescriptor): string {
  const lines: string[] = [];

  lines.push(`/**`);
  lines.push(` * ${svc.name} — Generated Tests`);
  lines.push(` *`);
  lines.push(` * AUTO-GENERATED by Phoenix VCS`);
  lines.push(` * Tests module structure, server health, and Phoenix traceability.`);
  lines.push(` */`);
  lines.push('');
  lines.push(`import { describe, it, expect, afterAll } from 'vitest';`);
  lines.push(`import { startServer } from '../server.js';`);
  lines.push('');

  // Import modules
  for (const mod of svc.modules) {
    const modName = mod.replace(/\.ts$/, '');
    const importName = toCamelCase(modName);
    lines.push(`import * as ${importName} from '../${modName}.js';`);
  }
  lines.push('');

  // Module structure tests
  lines.push(`describe('${svc.name} modules', () => {`);
  for (const mod of svc.modules) {
    const modName = mod.replace(/\.ts$/, '');
    const importName = toCamelCase(modName);
    const iu = svc.ius.find(u => u.output_files.some(f => f.includes(modName)));
    const displayName = iu?.name || modName;

    lines.push(`  describe('${displayName}', () => {`);
    lines.push(`    it('exports Phoenix traceability metadata', () => {`);
    lines.push(`      expect(${importName}._phoenix).toBeDefined();`);
    lines.push(`      expect(${importName}._phoenix.name).toBe('${displayName}');`);
    lines.push(`      expect(${importName}._phoenix.risk_tier).toBeTruthy();`);
    lines.push(`    });`);
    lines.push('');
    lines.push(`    it('has exported functions', () => {`);
    lines.push(`      const exports = Object.keys(${importName}).filter(k => k !== '_phoenix');`);
    lines.push(`      expect(exports.length).toBeGreaterThan(0);`);
    lines.push(`    });`);
    lines.push(`  });`);
    lines.push('');
  }
  lines.push(`});`);
  lines.push('');

  // Server tests
  lines.push(`describe('${svc.name} server', () => {`);
  lines.push(`  const instance = startServer(0); // random port`);
  lines.push('');
  lines.push(`  afterAll(() => new Promise<void>(resolve => instance.server.close(() => resolve())));`);
  lines.push('');
  lines.push(`  it('GET /health returns 200', async () => {`);
  lines.push(`    await instance.ready;`);
  lines.push(`    const res = await fetch(\`http://localhost:\${instance.port}/health\`);`);
  lines.push(`    expect(res.status).toBe(200);`);
  lines.push(`    const body = await res.json() as Record<string, unknown>;`);
  lines.push(`    expect(body.status).toBe('ok');`);
  lines.push(`    expect(body.service).toBe('${svc.name}');`);
  lines.push(`  });`);
  lines.push('');
  lines.push(`  it('GET /metrics returns request counts', async () => {`);
  lines.push(`    await instance.ready;`);
  lines.push(`    const res = await fetch(\`http://localhost:\${instance.port}/metrics\`);`);
  lines.push(`    expect(res.status).toBe(200);`);
  lines.push(`    const body = await res.json() as Record<string, unknown>;`);
  lines.push(`    expect(typeof body.requests_total).toBe('number');`);
  lines.push(`  });`);
  lines.push('');
  lines.push(`  it('GET /modules lists all registered modules', async () => {`);
  lines.push(`    await instance.ready;`);
  lines.push(`    const res = await fetch(\`http://localhost:\${instance.port}/modules\`);`);
  lines.push(`    expect(res.status).toBe(200);`);
  lines.push(`    const body = await res.json() as Array<Record<string, unknown>>;`);
  lines.push(`    expect(body.length).toBe(${svc.modules.length});`);
  lines.push(`  });`);
  lines.push('');
  lines.push(`  it('GET /unknown returns 404', async () => {`);
  lines.push(`    await instance.ready;`);
  lines.push(`    const res = await fetch(\`http://localhost:\${instance.port}/unknown\`);`);
  lines.push(`    expect(res.status).toBe(404);`);
  lines.push(`  });`);

  // Web client: test GET / serves HTML
  if (isWebClient(svc)) {
    lines.push('');
    lines.push(`  it('GET / serves HTML page', async () => {`);
    lines.push(`    await instance.ready;`);
    lines.push(`    const res = await fetch(\`http://localhost:\${instance.port}/\`);`);
    lines.push(`    expect(res.status).toBe(200);`);
    lines.push(`    const ct = res.headers.get('content-type') ?? '';`);
    lines.push(`    expect(ct).toContain('text/html');`);
    lines.push(`    const body = await res.text();`);
    lines.push(`    expect(body).toContain('<!DOCTYPE html>');`);
    lines.push(`    expect(body).toContain('<title>${svc.name}</title>');`);
    lines.push(`  });`);
  }

  lines.push(`});`);
  lines.push('');

  return lines.join('\n');
}

// ─── Root Index ──────────────────────────────────────────────────────────────

function generateRootIndex(services: ServiceDescriptor[]): string {
  const lines: string[] = [];

  lines.push(`/**`);
  lines.push(` * Phoenix VCS — Generated Service Registry`);
  lines.push(` *`);
  lines.push(` * AUTO-GENERATED by Phoenix VCS`);
  lines.push(` */`);
  lines.push('');

  for (const svc of services) {
    const importName = toCamelCase(svc.dir);
    lines.push(`export * as ${importName} from './${svc.dir}/index.js';`);
  }
  lines.push('');

  lines.push(`export const services = [`);
  for (const svc of services) {
    lines.push(`  { name: '${svc.name}', dir: '${svc.dir}', port: ${svc.port}, modules: ${svc.modules.length} },`);
  }
  lines.push(`] as const;`);
  lines.push('');

  return lines.join('\n');
}

// ─── Project Config ──────────────────────────────────────────────────────────

function generatePackageJson(
  services: ServiceDescriptor[],
  projectName: string,
  target?: ResolvedTarget | null,
): string {
  let scripts: Record<string, string> = {
    build: 'tsc',
    typecheck: 'tsc --noEmit',
    test: 'vitest run',
    'test:watch': 'vitest',
  };

  if (target) {
    const arch = target.architecture;
    const rt = target.runtime;
    // Architecture provides its own scripts
    const archScripts = (rt.packageExtras?.scripts ?? {}) as Record<string, string>;
    scripts = { ...scripts, ...archScripts };
  } else {
    // Add start script per service (build first, then run)
    for (const svc of services) {
      scripts[`start:${svc.dir}`] = `tsc && node dist/generated/${svc.dir}/server.js`;
    }
    if (services.length > 0) {
      scripts.start = `tsc && node dist/generated/${services[0].dir}/server.js`;
    }
  }

  const pkg: Record<string, unknown> = {
    name: projectName,
    version: '0.1.0',
    description: `Generated by Phoenix VCS — ${services.length} services`,
    type: 'module',
    scripts,
  };

  if (target) {
    const arch = target.architecture;
    const rt = target.runtime;
    pkg.dependencies = rt.packages;
    pkg.devDependencies = rt.devPackages;
  } else {
    pkg.devDependencies = {
      typescript: '^5.4.0',
      vitest: '^2.0.0',
      '@types/node': '^22.0.0',
    };
  }

  return JSON.stringify(pkg, null, 2) + '\n';
}

function generateTsConfig(): string {
  const config = {
    compilerOptions: {
      target: 'ES2022',
      module: 'ESNext',
      moduleResolution: 'bundler',
      declaration: true,
      outDir: 'dist',
      rootDir: 'src',
      strict: true,
      esModuleInterop: true,
      skipLibCheck: true,
      forceConsistentCasingInFileNames: true,
      resolveJsonModule: true,
      sourceMap: true,
    },
    include: ['src/**/*'],
    exclude: ['node_modules', 'dist'],
  };

  return JSON.stringify(config, null, 2) + '\n';
}

function generateVitestConfig(): string {
  return `import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/__tests__/**/*.test.ts'],
  },
});
`;
}

// ─── Utilities ───────────────────────────────────────────────────────────────

function dirToName(dir: string): string {
  return dir
    .split('-')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function toCamelCase(str: string): string {
  return str
    .replace(/[^a-zA-Z0-9]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((w, i) => i === 0 ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join('');
}
