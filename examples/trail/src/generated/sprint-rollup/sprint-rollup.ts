import { Hono } from 'hono';
import { db } from '../../db.js';
import { z } from 'zod';

const router = new Hono();

const CreateRollupSchema = z.object({
  sprint_id: z.number().int(),
});

const UpdateRollupSchema = z.object({
  sprint_id: z.number().int().optional(),
});

router.get('/', (c) => {
  const sprintId = c.req.query('sprint_id');
  let sql = 'SELECT * FROM sprint_rollup';
  const params: unknown[] = [];
  if (sprintId !== undefined) {
    sql += ' WHERE sprint_id = ?';
    params.push(Number(sprintId));
  }
  sql += ' ORDER BY last_updated DESC';
  return c.json(db.prepare(sql).all(...params));
});

router.get('/:id', (c) => {
  const rollup = db.prepare('SELECT * FROM sprint_rollup WHERE id = ?').get(c.req.param('id'));
  if (!rollup) return c.json({ error: 'Not found' }, 404);
  return c.json(rollup);
});

router.get('/sprint/:sprint_id', (c) => {
  const sprintId = c.req.param('sprint_id');
  
  // Get sprint details to check capacity
  const sprint = db.prepare('SELECT capacity FROM sprints WHERE id = ?').get(sprintId) as { capacity?: number } | undefined;
  if (!sprint) return c.json({ error: 'Sprint not found' }, 404);
  
  // Calculate rollup data from issues
  const issues = db.prepare('SELECT status, point_estimate FROM issues WHERE sprint_id = ?').all(sprintId) as { status: string; point_estimate?: number }[];
  
  let totalIssues = issues.length;
  let totalPoints = 0;
  let completedPoints = 0;
  let backlogCount = 0;
  let todoCount = 0;
  let inprogressCount = 0;
  let inreviewCount = 0;
  let doneCount = 0;
  
  for (const issue of issues) {
    const points = issue.point_estimate || 0;
    totalPoints += points;
    
    if (issue.status === 'done') {
      completedPoints += points;
      doneCount++;
    } else if (issue.status === 'backlog') {
      backlogCount++;
    } else if (issue.status === 'todo') {
      todoCount++;
    } else if (issue.status === 'inprogress') {
      inprogressCount++;
    } else if (issue.status === 'inreview') {
      inreviewCount++;
    }
  }
  
  const pointsRemaining = totalPoints - completedPoints;
  const percentComplete = totalPoints > 0 ? (completedPoints / totalPoints) * 100 : 0;
  
  const isOverCapacity = sprint.capacity != null && totalPoints > sprint.capacity;
  const overCapacityBy = isOverCapacity ? totalPoints - sprint.capacity : 0;
  
  const rollupData = {
    sprint_id: Number(sprintId),
    total_issues: totalIssues,
    total_points: totalPoints,
    completed_points: completedPoints,
    points_remaining: pointsRemaining,
    percent_complete: Math.round(percentComplete * 100) / 100,
    backlog_count: backlogCount,
    todo_count: todoCount,
    inprogress_count: inprogressCount,
    inreview_count: inreviewCount,
    done_count: doneCount,
    is_over_capacity: isOverCapacity ? 1 : 0,
    over_capacity_by: overCapacityBy,
    last_updated: new Date().toISOString()
  };
  
  return c.json(rollupData);
});

router.post('/', async (c) => {
  let body; try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }
  const result = CreateRollupSchema.safeParse(body);
  if (!result.success) return c.json({ error: result.error.issues[0].message }, 400);
  
  const { sprint_id } = result.data;
  
  // Verify sprint exists
  if (!db.prepare('SELECT id FROM sprints WHERE id = ?').get(sprint_id)) {
    return c.json({ error: 'Sprint not found' }, 400);
  }
  
  // Check if rollup already exists for this sprint
  const existing = db.prepare('SELECT id FROM sprint_rollup WHERE sprint_id = ?').get(sprint_id);
  if (existing) return c.json({ error: 'Rollup already exists for this sprint' }, 400);
  
  const info = db.prepare('INSERT INTO sprint_rollup (sprint_id) VALUES (?)').run(sprint_id);
  const rollup = db.prepare('SELECT * FROM sprint_rollup WHERE id = ?').get(info.lastInsertRowid);
  return c.json(rollup, 201);
});

router.patch('/:id', async (c) => {
  const id = c.req.param('id');
  if (!db.prepare('SELECT id FROM sprint_rollup WHERE id = ?').get(id)) return c.json({ error: 'Not found' }, 404);
  
  let body; try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }
  const result = UpdateRollupSchema.safeParse(body);
  if (!result.success) return c.json({ error: result.error.issues[0].message }, 400);
  
  const u = result.data;
  if (u.sprint_id !== undefined) {
    if (!db.prepare('SELECT id FROM sprints WHERE id = ?').get(u.sprint_id)) {
      return c.json({ error: 'Sprint not found' }, 400);
    }
    db.prepare("UPDATE sprint_rollup SET sprint_id = ?, last_updated = datetime('now') WHERE id = ?").run(u.sprint_id, id);
  }
  
  return c.json(db.prepare('SELECT * FROM sprint_rollup WHERE id = ?').get(id));
});

router.delete('/:id', (c) => {
  const id = c.req.param('id');
  if (!db.prepare('SELECT id FROM sprint_rollup WHERE id = ?').get(id)) return c.json({ error: 'Not found' }, 404);
  db.prepare('DELETE FROM sprint_rollup WHERE id = ?').run(id);
  return c.body(null, 204);
});







export default router;

/** @internal Phoenix VCS traceability — do not remove. */
export const _phoenix = {
  iu_id: 'd7fb39d4bab213da560a66643474b952db5c4f863294fb422e12ed2f6e776a30',
  name: 'sprint rollup',
  risk_tier: 'low',
  canon_ids: [3 as const],
} as const;
