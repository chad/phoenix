import { describe, it, expect } from 'vitest';
import {
  extractDeclaredRoutes, declaredSurfaces, moduleShapes, planMounts, describeMountPlan,
  RESERVED_PREFIXES,
} from '../../src/spec-interface.js';

// The statements below are taken verbatim from the canonical graph of the bench run that
// found the bug (bench/FINDINGS.md) — lowercased by the canonicalizer, as they arrive.
const CANON = [
  'get /health — returns 200 once the service is ready',
  'post /tasks — creates a task from a json body; returns 201 and the created task',
  'get /tasks — returns 200 and a json array of tasks',
  'get /tasks/:id — returns 200 and the task, or 404 if there is no such task',
  'patch /tasks/:id — updates the given fields; returns 200 and the updated task, or 404',
  'The system deletes /tasks/:id and returns 204 with no body, or returns 404.',
  'get /stats — returns 200 and { "total": n, "completed": n, "completion_percent": n }',
  'a task has a title, a priority, a completed flag, and a creation timestamp',
];

const TASK_MODULE = `
  const router = new Hono();
  router.get('/', (c) => c.json(list()));
  router.get('/:id', (c) => c.json(one(c.req.param('id'))));
  router.post('/', async (c) => c.json(created, 201));
  router.patch('/:id', async (c) => c.json(updated));
  router.delete('/:id', (c) => c.body(null, 204));
  export default router;
`;

const SUMMARY_MODULE = `
  const router = new Hono();
  router.get('/', (c) => c.json({ total, completed, completion_percent }));
  export default router;
`;

describe('reading the declared interface', () => {
  it('finds a route only where a method is adjacent to a path', () => {
    const routes = extractDeclaredRoutes(CANON);
    const shapes = routes.map(r => `${r.method} ${r.path}`);
    expect(shapes).toContain('POST /tasks');
    expect(shapes).toContain('GET /tasks/:id');
    expect(shapes).toContain('GET /stats');
    // "…deletes /tasks/:id and returns 204…" — the canonicalizer's rewrite still declares it.
    expect(shapes).toContain('DELETE /tasks/:id');
  });

  it('prose that merely mentions a path declares nothing', () => {
    expect(extractDeclaredRoutes(['tasks are stored under /tasks in the database'])).toEqual([]);
    expect(extractDeclaredRoutes(['the service exposes exactly these routes'])).toEqual([]);
  });

  it('strips markdown so a backticked declaration still counts', () => {
    const r = extractDeclaredRoutes(['- `POST /tasks` — creates a task']);
    expect(r).toEqual([{ method: 'POST', path: '/tasks' }]);
  });

  it('groups routes into mountable surfaces and leaves the shell its own paths', () => {
    const surfaces = declaredSurfaces(extractDeclaredRoutes(CANON));
    expect(surfaces.map(s => s.prefix)).toEqual(['stats', 'tasks']);
    expect(surfaces.find(s => s.prefix === 'tasks')!.shapes).toEqual([
      'DELETE /:x', 'GET /', 'GET /:x', 'PATCH /:x', 'POST /',
    ]);
    expect(surfaces.some(s => s.prefix === 'health')).toBe(false);
    expect(RESERVED_PREFIXES.has('health')).toBe(true);
  });

  it('treats :id, {id} and <id> as the same parameter', () => {
    const a = declaredSurfaces(extractDeclaredRoutes(['GET /tasks/:id']));
    const b = declaredSurfaces(extractDeclaredRoutes(['GET /tasks/{id}']));
    expect(a[0].shapes).toEqual(b[0].shapes);
  });
});

describe('reading what a module implements', () => {
  it('normalises the module\'s own router registrations', () => {
    expect(moduleShapes(TASK_MODULE)).toEqual(['DELETE /:x', 'GET /', 'GET /:x', 'PATCH /:x', 'POST /']);
    expect(moduleShapes(SUMMARY_MODULE)).toEqual(['GET /']);
  });
});

describe('placing the declared surface', () => {
  const surfaces = declaredSurfaces(extractDeclaredRoutes(CANON));
  const modules = [
    { key: 'src/generated/task/task.ts', name: 'task', shapes: moduleShapes(TASK_MODULE) },
    { key: 'src/generated/summary/summary.ts', name: 'summary', shapes: moduleShapes(SUMMARY_MODULE) },
  ];

  it('mounts the module that implements the declared shapes — the bug the bench found', () => {
    const plan = planMounts(surfaces, modules);
    expect(plan.decisions.get('src/generated/task/task.ts')?.prefix).toBe('/tasks');
    expect(plan.decisions.get('src/generated/summary/summary.ts')?.prefix).toBe('/stats');
    expect(plan.unplaced).toEqual([]);
  });

  it('places /stats on the summary module structurally, without knowing the word "stats"', () => {
    const plan = planMounts(surfaces, modules);
    const d = plan.decisions.get('src/generated/summary/summary.ts')!;
    expect(d.basis).toBe('structural');
    expect(d.why).toContain('declared route shapes');
  });

  it('a unit whose name has nothing to do with the URL still wins on structure', () => {
    const oddly = [{ key: 'src/generated/widget/widget.ts', name: 'widget', shapes: moduleShapes(TASK_MODULE) }];
    const plan = planMounts(declaredSurfaces(extractDeclaredRoutes(['GET /tasks', 'POST /tasks', 'GET /tasks/:id'])), oddly);
    expect(plan.decisions.get('src/generated/widget/widget.ts')?.prefix).toBe('/tasks');
  });

  it('claims each module and each prefix at most once', () => {
    const plan = planMounts(surfaces, modules);
    const prefixes = [...plan.decisions.values()].map(d => d.prefix);
    expect(new Set(prefixes).size).toBe(prefixes.length);
    expect(plan.decisions.size).toBeLessThanOrEqual(modules.length);
  });

  it('ABSTAINS when two modules are equally good — a confident wrong mount is the worse failure', () => {
    const twins = [
      { key: 'a.ts', name: 'alpha', shapes: moduleShapes(SUMMARY_MODULE) },
      { key: 'b.ts', name: 'beta', shapes: moduleShapes(SUMMARY_MODULE) },
    ];
    const plan = planMounts(declaredSurfaces(extractDeclaredRoutes(['GET /stats'])), twins);
    expect(plan.decisions.size).toBe(0);
    expect(plan.unplaced.map(s => s.prefix)).toEqual(['stats']);
  });

  it('reports a declared surface nothing implements, rather than swallowing it', () => {
    const plan = planMounts(declaredSurfaces(extractDeclaredRoutes(['GET /projects', 'POST /projects'])), modules);
    expect(plan.decisions.size).toBe(0);
    expect(describeMountPlan(plan, k => k).join('\n')).toContain('/projects declared in spec but not placed');
  });

  it('says nothing at all when the spec declares no interface — the slug rule stands', () => {
    const plan = planMounts(declaredSurfaces(extractDeclaredRoutes(['tasks have titles'])), modules);
    expect(plan.decisions.size).toBe(0);
    expect(plan.unplaced).toEqual([]);
  });

  it('explains every placement with the evidence that produced it', () => {
    const lines = describeMountPlan(planMounts(surfaces, modules), k => k);
    expect(lines.join('\n')).toContain('declared in spec');
    expect(lines.join('\n')).toMatch(/\d+\/\d+ declared route shapes/);
  });
});
