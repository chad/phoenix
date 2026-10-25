import { describe, it, expect } from 'vitest';
import { planRootMounts, planMounts, declaredSurfaces, extractDeclaredRoutes } from '../../src/spec-interface.js';

const routes = extractDeclaredRoutes([
  '`POST /questions` — asks a question',
  '`GET /questions/:id` — returns the question',
  '`POST /votes` — upvotes',
  '`GET /board` — the ranked board',
]);

describe('planRootMounts — modules written against full paths', () => {
  it('mounts a module that registers declared full paths at the root', () => {
    const d = planRootMounts(routes, [{ key: 'vote.ts', name: 'vote', shapes: ['POST /votes'] }]);
    expect(d.get('vote.ts')?.prefix).toBe('');
  });

  it('leaves a relative module to prefix placement', () => {
    const mods = [
      { key: 'vote.ts', name: 'vote', shapes: ['POST /'] },
      { key: 'question.ts', name: 'question', shapes: ['POST /', 'GET /:x'] },
    ];
    expect(planRootMounts(routes, mods).size).toBe(0);
    expect(planMounts(declaredSurfaces(routes), mods).decisions.get('vote.ts')?.prefix).toBe('/votes');
  });

  it('one coincidental full-path match does not move a module to the root', () => {
    const d = planRootMounts(routes, [{ key: 'b.ts', name: 'board', shapes: ['GET /', 'POST /', 'GET /:x', 'GET /board'] }]);
    expect(d.size).toBe(0);
  });
});


describe('planAllMounts — a surface a root module serves is not up for grabs', () => {
  it('does not mount the web UI at /board when the board module serves /board by full path', async () => {
    const { planAllMounts } = await import('../../src/spec-interface.js');
    const r = extractDeclaredRoutes(['`GET /` the page', '`GET /board` the board', '`POST /votes` vote']);
    const plan = planAllMounts(r, [
      { key: 'board.py', name: 'board', shapes: ['GET /board'] },
      { key: 'web_ui.py', name: 'web ui', shapes: ['GET /'] },
      { key: 'vote.py', name: 'vote', shapes: ['POST /'] },
    ]);
    expect(plan.decisions.get('board.py')?.prefix).toBe('');
    expect(plan.decisions.get('web_ui.py')).toBeUndefined();   // falls through to the UI root rule
    expect(plan.decisions.get('vote.py')?.prefix).toBe('/votes');
    expect(plan.unplaced).toEqual([]);
  });
});
