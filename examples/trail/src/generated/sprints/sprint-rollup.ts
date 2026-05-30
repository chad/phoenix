import { Hono } from 'hono';
import { db, registerMigration } from '../../db.js';
import { z } from 'zod';

// ─── Database migrations ────────────────────────────────────────────────────

// ─── Database migrations ────────────────────────────────────────────────────

registerMigration('sprint_rollups', `
  CREATE TABLE IF NOT EXISTS sprint_rollups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sprint_id INTEGER NOT NULL UNIQUE REFERENCES sprints(id),
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
    capacity_exceeded_by INTEGER NOT NULL DEFAULT 0,
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
  let sql = 'SELECT * FROM sprint_rollups';
  const params: unknown[] = [];
  if (sprintId !== undefined) {
    sql += ' WHERE sprint_id = ?';
    params.push(Number(sprintId));
  }
  sql += ' ORDER BY created_at DESC';
  return c.json(db.prepare(sql).all(...params));
});

router.get('/:id', (c) => {
  const rollup = db.prepare('SELECT * FROM sprint_rollups WHERE id = ?').get(c.req.param('id'));
  if (!rollup) return c.json({ error: 'Not found' }, 404);
  return c.json(rollup);
});

router.post('/', async (c) => {
  let body; try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }
  const result = CreateRollupSchema.safeParse(body);
  if (!result.success) return c.json({ error: result.error.issues[0].message }, 400);
  const { sprint_id } = result.data;
  
  // Validate sprint exists
  const sprint = db.prepare('SELECT id, capacity FROM sprints WHERE id = ?').get(sprint_id) as { id: number; capacity: number } | undefined;
  if (!sprint) return c.json({ error: 'Sprint not found' }, 400);
  
  // Fetch issues for this sprint
  const issues = db.prepare('SELECT status, point_estimate FROM issues WHERE sprint_id = ?').all(sprint_id) as { status: string; point_estimate: number | null }[];
  
  // Calculate rollup metrics
  const totalIssues = issues.length;
  const totalPoints = issues.reduce((sum, issue) => sum + (issue.point_estimate || 0), 0);
  const completedPoints = issues.filter(issue => issue.status === 'done').reduce((sum, issue) => sum + (issue.point_estimate || 0), 0);
  const pointsRemaining = totalPoints - completedPoints;
  const completionPercentage = totalPoints > 0 ? (completedPoints / totalPoints) * 100 : 0;
  
  // Count issues by status
  const backlogCount = issues.filter(issue => issue.status === 'backlog').length;
  const todoCount = issues.filter(issue => issue.status === 'todo').length;
  const inprogressCount = issues.filter(issue => issue.status === 'inprogress').length;
  const inreviewCount = issues.filter(issue => issue.status === 'inreview').length;
  const doneCount = issues.filter(issue => issue.status === 'done').length;
  
  // Check capacity
  const isOverCapacity = totalPoints > sprint.capacity ? 1 : 0;
  const capacityExceededBy = Math.max(0, totalPoints - sprint.capacity);
  
  const info = db.prepare(`
    INSERT INTO sprint_rollups (
      sprint_id, total_issues, total_points, completed_points, points_remaining, 
      completion_percentage, backlog_count, todo_count, inprogress_count, 
      inreview_count, done_count, is_over_capacity, capacity_exceeded_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    sprint_id, totalIssues, totalPoints, completedPoints, pointsRemaining,
    completionPercentage, backlogCount, todoCount, inprogressCount,
    inreviewCount, doneCount, isOverCapacity, capacityExceededBy
  );
  
  const rollup = db.prepare('SELECT * FROM sprint_rollups WHERE id = ?').get(info.lastInsertRowid);
  return c.json(rollup, 201);
});

router.patch('/:id', async (c) => {
  const id = c.req.param('id');
  const existingRollup = db.prepare('SELECT * FROM sprint_rollups WHERE id = ?').get(id);
  if (!existingRollup) return c.json({ error: 'Not found' }, 404);
  
  let body; try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }
  const result = UpdateRollupSchema.safeParse(body);
  if (!result.success) return c.json({ error: result.error.issues[0].message }, 400);
  const u = result.data;
  
  if (u.sprint_id !== undefined) {
    const sprint = db.prepare('SELECT id, capacity FROM sprints WHERE id = ?').get(u.sprint_id) as { id: number; capacity: number } | undefined;
    if (!sprint) return c.json({ error: 'Sprint not found' }, 400);
    
    // Recalculate rollup for new sprint
    const issues = db.prepare('SELECT status, point_estimate FROM issues WHERE sprint_id = ?').all(u.sprint_id) as { status: string; point_estimate: number | null }[];
    
    const totalIssues = issues.length;
    const totalPoints = issues.reduce((sum, issue) => sum + (issue.point_estimate || 0), 0);
    const completedPoints = issues.filter(issue => issue.status === 'done').reduce((sum, issue) => sum + (issue.point_estimate || 0), 0);
    const pointsRemaining = totalPoints - completedPoints;
    const completionPercentage = totalPoints > 0 ? (completedPoints / totalPoints) * 100 : 0;
    
    const backlogCount = issues.filter(issue => issue.status === 'backlog').length;
    const todoCount = issues.filter(issue => issue.status === 'todo').length;
    const inprogressCount = issues.filter(issue => issue.status === 'inprogress').length;
    const inreviewCount = issues.filter(issue => issue.status === 'inreview').length;
    const doneCount = issues.filter(issue => issue.status === 'done').length;
    
    const isOverCapacity = totalPoints > sprint.capacity ? 1 : 0;
    const capacityExceededBy = Math.max(0, totalPoints - sprint.capacity);
    
    db.prepare(`
      UPDATE sprint_rollups SET 
        sprint_id = ?, total_issues = ?, total_points = ?, completed_points = ?, 
        points_remaining = ?, completion_percentage = ?, backlog_count = ?, 
        todo_count = ?, inprogress_count = ?, inreview_count = ?, done_count = ?, 
        is_over_capacity = ?, capacity_exceeded_by = ?
      WHERE id = ?
    `).run(
      u.sprint_id, totalIssues, totalPoints, completedPoints, pointsRemaining,
      completionPercentage, backlogCount, todoCount, inprogressCount,
      inreviewCount, doneCount, isOverCapacity, capacityExceededBy, id
    );
  }
  
  return c.json(db.prepare('SELECT * FROM sprint_rollups WHERE id = ?').get(id));
});

router.delete('/:id', (c) => {
  const id = c.req.param('id');
  if (!db.prepare('SELECT id FROM sprint_rollups WHERE id = ?').get(id)) return c.json({ error: 'Not found' }, 404);
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
