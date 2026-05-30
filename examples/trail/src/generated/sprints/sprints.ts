import { Hono } from 'hono';
import { db, registerMigration } from '../../db.js';
import { z } from 'zod';

// ─── Database migrations ────────────────────────────────────────────────────

registerMigration('sprints', `
  CREATE TABLE IF NOT EXISTS sprints (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    goal TEXT,
    start_date TEXT NOT NULL,
    end_date TEXT NOT NULL,
    capacity INTEGER,
    is_current INTEGER NOT NULL DEFAULT 0,
    is_closed INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )
`);

const CreateSprintSchema = z.object({
  name: z.string().min(1).max(200),
  goal: z.string().optional(),
  start_date: z.string().min(1),
  end_date: z.string().min(1),
  capacity: z.number().int().positive().optional(),
});

const UpdateSprintSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  goal: z.string().optional(),
  start_date: z.string().min(1).optional(),
  end_date: z.string().min(1).optional(),
  capacity: z.number().int().positive().optional(),
  is_current: z.boolean().optional(),
  is_closed: z.boolean().optional(),
});

const router = new Hono();

router.get('/', (c) => {
  let sql = 'SELECT * FROM sprints';
  const conditions: string[] = [];
  const params: unknown[] = [];
  
  const isCurrent = c.req.query('is_current');
  if (isCurrent !== undefined) {
    conditions.push('is_current = ?');
    params.push(isCurrent === 'true' ? 1 : 0);
  }
  
  const isClosed = c.req.query('is_closed');
  if (isClosed !== undefined) {
    conditions.push('is_closed = ?');
    params.push(isClosed === 'true' ? 1 : 0);
  }
  
  if (conditions.length > 0) sql += ' WHERE ' + conditions.join(' AND ');
  sql += ' ORDER BY is_closed ASC, start_date DESC';
  
  return c.json(db.prepare(sql).all(...params));
});

router.get('/:id', (c) => {
  const sprint = db.prepare('SELECT * FROM sprints WHERE id = ?').get(c.req.param('id'));
  if (!sprint) return c.json({ error: 'Not found' }, 404);
  return c.json(sprint);
});

router.post('/', async (c) => {
  let body;
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }
  
  const result = CreateSprintSchema.safeParse(body);
  if (!result.success) return c.json({ error: result.error.issues[0].message }, 400);
  
  const { name, goal, start_date, end_date, capacity } = result.data;
  
  const info = db.prepare('INSERT INTO sprints (name, goal, start_date, end_date, capacity) VALUES (?, ?, ?, ?, ?)').run(
    name, goal ?? null, start_date, end_date, capacity ?? null
  );
  
  const sprint = db.prepare('SELECT * FROM sprints WHERE id = ?').get(info.lastInsertRowid);
  return c.json(sprint, 201);
});

router.patch('/:id', async (c) => {
  const id = c.req.param('id');
  if (!db.prepare('SELECT id FROM sprints WHERE id = ?').get(id)) return c.json({ error: 'Not found' }, 404);
  
  let body;
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }
  
  const result = UpdateSprintSchema.safeParse(body);
  if (!result.success) return c.json({ error: result.error.issues[0].message }, 400);
  
  const u = result.data;
  
  if (u.is_current === true) {
    db.prepare('UPDATE sprints SET is_current = 0').run();
  }
  
  if (u.name !== undefined) db.prepare('UPDATE sprints SET name = ? WHERE id = ?').run(u.name, id);
  if (u.goal !== undefined) db.prepare('UPDATE sprints SET goal = ? WHERE id = ?').run(u.goal, id);
  if (u.start_date !== undefined) db.prepare('UPDATE sprints SET start_date = ? WHERE id = ?').run(u.start_date, id);
  if (u.end_date !== undefined) db.prepare('UPDATE sprints SET end_date = ? WHERE id = ?').run(u.end_date, id);
  if (u.capacity !== undefined) db.prepare('UPDATE sprints SET capacity = ? WHERE id = ?').run(u.capacity, id);
  if (u.is_current !== undefined) db.prepare('UPDATE sprints SET is_current = ? WHERE id = ?').run(u.is_current ? 1 : 0, id);
  if (u.is_closed !== undefined) db.prepare('UPDATE sprints SET is_closed = ? WHERE id = ?').run(u.is_closed ? 1 : 0, id);
  
  return c.json(db.prepare('SELECT * FROM sprints WHERE id = ?').get(id));
});

router.delete('/:id', (c) => {
  const id = c.req.param('id');
  if (!db.prepare('SELECT id FROM sprints WHERE id = ?').get(id)) return c.json({ error: 'Not found' }, 404);
  
  const issueCount = db.prepare('SELECT COUNT(*) as count FROM issues WHERE sprint_id = ?').get(id) as { count: number };
  if (issueCount.count > 0) {
    return c.json({ error: 'Cannot delete sprint with attached issues' }, 400);
  }
  
  db.prepare('DELETE FROM sprints WHERE id = ?').run(id);
  return c.body(null, 204);
});



export default router;

/** @internal Phoenix VCS traceability — do not remove. */
export const _phoenix = {
  iu_id: '7b9f964a95c3555aa97ce3a64c1382be65c433a813dea8fe988ca8c17d47dd02',
  name: 'Sprints',
  risk_tier: 'low',
  canon_ids: [3 as const],
} as const;
