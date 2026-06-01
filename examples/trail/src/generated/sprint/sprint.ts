import { Hono } from 'hono';
import { db } from '../../db.js';
import { z } from 'zod';

// ─── Schemas ────────────────────────────────────────────────────────────────

const CreateSprintSchema = z.object({
  name: z.string().min(1).max(80),
  goal: z.string().max(280).nullable().optional(),
  start_date: z.string(),
  end_date: z.string(),
  capacity: z.number().int().positive().nullable().optional(),
  is_current: z.boolean().optional().default(false),
  is_closed: z.boolean().optional().default(false),
});

const UpdateSprintSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  goal: z.string().max(280).nullable().optional(),
  start_date: z.string().optional(),
  end_date: z.string().optional(),
  capacity: z.number().int().positive().nullable().optional(),
  is_current: z.boolean().optional(),
  is_closed: z.boolean().optional(),
});

// ─── Routes ─────────────────────────────────────────────────────────────────

const router = new Hono();

router.get('/', (c) => {
  const sprints = db.prepare('SELECT * FROM sprints ORDER BY is_closed ASC, start_date DESC').all();
  return c.json(sprints);
});

router.get('/:id', (c) => {
  const sprint = db.prepare('SELECT * FROM sprints WHERE id = ?').get(c.req.param('id'));
  if (!sprint) return c.json({ error: 'Not found' }, 404);
  return c.json(sprint);
});

router.post('/', async (c) => {
  let body; try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }
  const result = CreateSprintSchema.safeParse(body);
  if (!result.success) return c.json({ error: result.error.issues[0].message }, 400);
  
  const { name, goal, start_date, end_date, capacity, is_current, is_closed } = result.data;
  
  // Validate dates
  const startDate = new Date(start_date);
  const endDate = new Date(end_date);
  if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
    return c.json({ error: 'Invalid date format' }, 400);
  }
  if (endDate < startDate) {
    return c.json({ error: 'End date cannot be before start date' }, 400);
  }
  
  // If setting as current, clear other current sprints
  if (is_current) {
    db.prepare('UPDATE sprints SET is_current = 0').run();
  }
  
  const info = db.prepare('INSERT INTO sprints (name, goal, start_date, end_date, capacity, is_current, is_closed) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
    name, goal ?? null, start_date, end_date, capacity ?? null, is_current ? 1 : 0, is_closed ? 1 : 0
  );
  
  const sprint = db.prepare('SELECT * FROM sprints WHERE id = ?').get(info.lastInsertRowid);
  return c.json(sprint, 201);
});

router.patch('/:id', async (c) => {
  const id = c.req.param('id');
  const sprint = db.prepare('SELECT * FROM sprints WHERE id = ?').get(id) as any;
  if (!sprint) return c.json({ error: 'Not found' }, 404);
  
  let body; try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }
  const result = UpdateSprintSchema.safeParse(body);
  if (!result.success) return c.json({ error: result.error.issues[0].message }, 400);
  
  const u = result.data;
  
  // Validate dates if provided
  if (u.start_date !== undefined || u.end_date !== undefined) {
    const startDate = new Date(u.start_date ?? sprint.start_date);
    const endDate = new Date(u.end_date ?? sprint.end_date);
    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      return c.json({ error: 'Invalid date format' }, 400);
    }
    if (endDate < startDate) {
      return c.json({ error: 'End date cannot be before start date' }, 400);
    }
  }
  
  // If setting as current, clear other current sprints
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
  
  // Check if any issues are attached to this sprint
  const attachedIssues = db.prepare('SELECT COUNT(*) as count FROM issues WHERE sprint_id = ?').get(id) as { count: number };
  if (attachedIssues.count > 0) {
    return c.json({ error: 'Cannot delete sprint with attached issues. Move issues to another sprint or back to backlog first.' }, 400);
  }
  
  db.prepare('DELETE FROM sprints WHERE id = ?').run(id);
  return c.body(null, 204);
});



export default router;

/** @internal Phoenix VCS traceability — do not remove. */
export const _phoenix = {
  iu_id: '71cccbcf51d41c225a0178f08d565f45ff1ba67766412db0f5fe682d56771d28',
  name: 'sprint',
  risk_tier: 'high',
  canon_ids: [9 as const],
} as const;
