import { Hono } from 'hono';
import { db, registerMigration } from '../../db.js';
import { z } from 'zod';

// ─── Database migrations ────────────────────────────────────────────────────

// ─── Database migrations ────────────────────────────────────────────────────

registerMigration('sprint_rollups', `
  CREATE TABLE IF NOT EXISTS sprint_rollups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sprint_id INTEGER NOT NULL REFERENCES sprints(id),
    total_issues INTEGER NOT NULL DEFAULT 0,
    total_points INTEGER NOT NULL DEFAULT 0,
    completed_points INTEGER NOT NULL DEFAULT 0,
    points_remaining INTEGER NOT NULL DEFAULT 0,
    completion_percentage REAL NOT NULL DEFAULT 0.0,
    backlog_count INTEGER NOT NULL DEFAULT 0,
    todo_count INTEGER NOT NULL DEFAULT 0,
    inprogress_count INTEGER NOT NULL DEFAULT 0,
    inreview_count INTEGER NOT NULL DEFAULT 0,
    done_count INTEGER NOT NULL DEFAULT 0,
    is_over_capacity INTEGER NOT NULL DEFAULT 0,
    capacity_excess INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )
`);

// ─── Schemas ────────────────────────────────────────────────────────────────

const CreateRollupSchema = z.object({
  sprint_id: z.number().int(),
});

const UpdateRollupSchema = z.object({
  sprint_id: z.number().int().optional(),
});

// ─── Routes ─────────────────────────────────────────────────────────────────

const router = new Hono();

router.get('/', (c) => {
  const sprintId = c.req.query('sprint_id');
  let sql = `
    SELECT 
      sr.*,
      s.name as sprint_name,
      s.capacity as sprint_capacity
    FROM sprint_rollups sr
    LEFT JOIN sprints s ON sr.sprint_id = s.id
  `;
  const conditions: string[] = [];
  const params: unknown[] = [];
  
  if (sprintId !== undefined) {
    conditions.push('sr.sprint_id = ?');
    params.push(Number(sprintId));
  }
  
  if (conditions.length > 0) sql += ' WHERE ' + conditions.join(' AND ');
  sql += ' ORDER BY sr.created_at DESC';
  
  return c.json(db.prepare(sql).all(...params));
});

router.get('/:id', (c) => {
  const rollup = db.prepare(`
    SELECT 
      sr.*,
      s.name as sprint_name,
      s.capacity as sprint_capacity
    FROM sprint_rollups sr
    LEFT JOIN sprints s ON sr.sprint_id = s.id
    WHERE sr.id = ?
  `).get(c.req.param('id'));
  
  if (!rollup) return c.json({ error: 'Not found' }, 404);
  return c.json(rollup);
});

router.post('/', async (c) => {
  let body;
  try { 
    body = await c.req.json(); 
  } catch { 
    return c.json({ error: 'Invalid JSON' }, 400); 
  }
  
  const result = CreateRollupSchema.safeParse(body);
  if (!result.success) return c.json({ error: result.error.issues[0].message }, 400);
  
  const { sprint_id } = result.data;
  
  // Validate sprint exists
  const sprint = db.prepare('SELECT id, capacity FROM sprints WHERE id = ?').get(sprint_id) as { id: number; capacity: number } | undefined;
  if (!sprint) return c.json({ error: 'Sprint not found' }, 400);
  
  // Calculate rollup data from issues
  const issues = db.prepare('SELECT status, point_estimate FROM issues WHERE sprint_id = ?').all(sprint_id) as { status: string; point_estimate: number | null }[];
  
  let total_issues = issues.length;
  let total_points = 0;
  let completed_points = 0;
  let backlog_count = 0;
  let todo_count = 0;
  let inprogress_count = 0;
  let inreview_count = 0;
  let done_count = 0;
  
  for (const issue of issues) {
    const points = issue.point_estimate || 0;
    total_points += points;
    
    if (issue.status === 'done') {
      completed_points += points;
      done_count++;
    } else if (issue.status === 'backlog') {
      backlog_count++;
    } else if (issue.status === 'todo') {
      todo_count++;
    } else if (issue.status === 'inprogress') {
      inprogress_count++;
    } else if (issue.status === 'inreview') {
      inreview_count++;
    }
  }
  
  const points_remaining = total_points - completed_points;
  const completion_percentage = total_points > 0 ? (completed_points / total_points) * 100 : 0;
  
  // Check capacity excess
  const capacity = sprint.capacity || 0;
  const is_over_capacity = total_points > capacity ? 1 : 0;
  const capacity_excess = Math.max(0, total_points - capacity);
  
  const info = db.prepare(`
    INSERT INTO sprint_rollups (
      sprint_id, total_issues, total_points, completed_points, points_remaining,
      completion_percentage, backlog_count, todo_count, inprogress_count,
      inreview_count, done_count, is_over_capacity, capacity_excess
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    sprint_id, total_issues, total_points, completed_points, points_remaining,
    completion_percentage, backlog_count, todo_count, inprogress_count,
    inreview_count, done_count, is_over_capacity, capacity_excess
  );
  
  const rollup = db.prepare(`
    SELECT 
      sr.*,
      s.name as sprint_name,
      s.capacity as sprint_capacity
    FROM sprint_rollups sr
    LEFT JOIN sprints s ON sr.sprint_id = s.id
    WHERE sr.id = ?
  `).get(info.lastInsertRowid);
  
  return c.json(rollup, 201);
});

router.patch('/:id', async (c) => {
  const id = c.req.param('id');
  const existing = db.prepare('SELECT id, sprint_id FROM sprint_rollups WHERE id = ?').get(id);
  if (!existing) return c.json({ error: 'Not found' }, 404);
  
  let body;
  try { 
    body = await c.req.json(); 
  } catch { 
    return c.json({ error: 'Invalid JSON' }, 400); 
  }
  
  const result = UpdateRollupSchema.safeParse(body);
  if (!result.success) return c.json({ error: result.error.issues[0].message }, 400);
  
  const u = result.data;
  
  if (u.sprint_id !== undefined) {
    // Validate new sprint exists
    if (!db.prepare('SELECT id FROM sprints WHERE id = ?').get(u.sprint_id)) {
      return c.json({ error: 'Sprint not found' }, 400);
    }
    db.prepare('UPDATE sprint_rollups SET sprint_id = ? WHERE id = ?').run(u.sprint_id, id);
  }
  
  const rollup = db.prepare(`
    SELECT 
      sr.*,
      s.name as sprint_name,
      s.capacity as sprint_capacity
    FROM sprint_rollups sr
    LEFT JOIN sprints s ON sr.sprint_id = s.id
    WHERE sr.id = ?
  `).get(id);
  
  return c.json(rollup);
});

router.delete('/:id', (c) => {
  const id = c.req.param('id');
  if (!db.prepare('SELECT id FROM sprint_rollups WHERE id = ?').get(id)) {
    return c.json({ error: 'Not found' }, 404);
  }
  
  db.prepare('DELETE FROM sprint_rollups WHERE id = ?').run(id);
  return c.body(null, 204);
});



export default router;

/** @internal Phoenix VCS traceability — do not remove. */
export const _phoenix = {
  iu_id: 'd316d83ecbe26aff79369e7ea7b451c3322da29a5a797c9ef6d96b0a39173278',
  name: 'Sprint rollup',
  risk_tier: 'low',
  canon_ids: [3 as const],
} as const;
