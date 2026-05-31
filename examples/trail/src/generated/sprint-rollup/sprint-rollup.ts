import { Hono } from 'hono';
import { db } from '../../db.js';
import { z } from 'zod';

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
    SELECT sr.*, s.name as sprint_name, s.capacity as sprint_capacity
    FROM sprint_rollup sr
    LEFT JOIN sprints s ON sr.sprint_id = s.id
  `;
  const params: unknown[] = [];
  if (sprintId !== undefined) {
    sql += ' WHERE sr.sprint_id = ?';
    params.push(Number(sprintId));
  }
  sql += ' ORDER BY sr.created_at DESC';
  return c.json(db.prepare(sql).all(...params));
});

router.get('/:id', (c) => {
  const rollup = db.prepare(`
    SELECT sr.*, s.name as sprint_name, s.capacity as sprint_capacity
    FROM sprint_rollup sr
    LEFT JOIN sprints s ON sr.sprint_id = s.id
    WHERE sr.id = ?
  `).get(c.req.param('id'));
  if (!rollup) return c.json({ error: 'Not found' }, 404);
  return c.json(rollup);
});

router.post('/', async (c) => {
  let body; try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }
  const result = CreateRollupSchema.safeParse(body);
  if (!result.success) return c.json({ error: result.error.issues[0].message }, 400);
  const { sprint_id } = result.data;
  
  // Validate sprint exists
  const sprint = db.prepare('SELECT id, capacity FROM sprints WHERE id = ?').get(sprint_id) as { id: number; capacity?: number } | undefined;
  if (!sprint) return c.json({ error: 'Sprint not found' }, 400);
  
  // Calculate rollup data
  const issues = db.prepare('SELECT status, point_estimate FROM issues WHERE sprint_id = ?').all(sprint_id) as { status: string; point_estimate?: number }[];
  
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
  
  const capacity = sprint.capacity ?? null;
  const isOverCapacity = capacity != null && totalPoints > capacity ? 1 : 0;
  const overCapacityBy = capacity != null && totalPoints > capacity ? totalPoints - capacity : 0;
  
  const info = db.prepare(`
    INSERT INTO sprint_rollup (
      sprint_id, total_issues, total_points, completed_points, points_remaining,
      percent_complete, backlog_count, todo_count, inprogress_count, inreview_count,
      done_count, is_over_capacity, over_capacity_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    sprint_id, totalIssues, totalPoints, completedPoints, pointsRemaining,
    percentComplete, backlogCount, todoCount, inprogressCount, inreviewCount,
    doneCount, isOverCapacity, overCapacityBy
  );
  
  const rollup = db.prepare(`
    SELECT sr.*, s.name as sprint_name, s.capacity as sprint_capacity
    FROM sprint_rollup sr
    LEFT JOIN sprints s ON sr.sprint_id = s.id
    WHERE sr.id = ?
  `).get(info.lastInsertRowid);
  return c.json(rollup, 201);
});

router.patch('/:id', async (c) => {
  const id = c.req.param('id');
  const existing = db.prepare('SELECT id, sprint_id FROM sprint_rollup WHERE id = ?').get(id);
  if (!existing) return c.json({ error: 'Not found' }, 404);
  
  let body; try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }
  const result = UpdateRollupSchema.safeParse(body);
  if (!result.success) return c.json({ error: result.error.issues[0].message }, 400);
  
  const u = result.data;
  if (u.sprint_id !== undefined) {
    const sprint = db.prepare('SELECT id FROM sprints WHERE id = ?').get(u.sprint_id);
    if (!sprint) return c.json({ error: 'Sprint not found' }, 400);
    db.prepare('UPDATE sprint_rollup SET sprint_id = ? WHERE id = ?').run(u.sprint_id, id);
  }
  
  return c.json(db.prepare(`
    SELECT sr.*, s.name as sprint_name, s.capacity as sprint_capacity
    FROM sprint_rollup sr
    LEFT JOIN sprints s ON sr.sprint_id = s.id
    WHERE sr.id = ?
  `).get(id));
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
