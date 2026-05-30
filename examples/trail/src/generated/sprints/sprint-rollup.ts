import { Hono } from 'hono';
import { db, registerMigration } from '../../db.js';
import { z } from 'zod';

// ─── Database migrations ────────────────────────────────────────────────────

const router = new Hono();

registerMigration('sprint_rollups', `
  CREATE TABLE IF NOT EXISTS sprint_rollups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sprint_id INTEGER NOT NULL REFERENCES sprints(id),
    total_issues INTEGER NOT NULL DEFAULT 0,
    total_points INTEGER NOT NULL DEFAULT 0,
    completed_points INTEGER NOT NULL DEFAULT 0,
    points_remaining INTEGER NOT NULL DEFAULT 0,
    percent_complete REAL NOT NULL DEFAULT 0.0,
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

const SprintRollupSchema = z.object({
  id: z.number().int(),
  sprint_id: z.number().int(),
  total_issues: z.number().int(),
  total_points: z.number().int(),
  completed_points: z.number().int(),
  points_remaining: z.number().int(),
  percent_complete: z.number(),
  backlog_count: z.number().int(),
  todo_count: z.number().int(),
  inprogress_count: z.number().int(),
  inreview_count: z.number().int(),
  done_count: z.number().int(),
  is_over_capacity: z.boolean(),
  capacity_exceeded_by: z.number().int(),
  created_at: z.string(),
});

router.get('/', (c) => {
  const sprintId = c.req.query('sprint_id');
  if (sprintId) {
    return c.json(computeSprintRollup(Number(sprintId)));
  }
  
  const rollups = db.prepare(`
    SELECT * FROM sprint_rollups 
    ORDER BY created_at DESC
  `).all();
  return c.json(rollups);
});

router.get('/:sprint_id', (c) => {
  const sprintId = Number(c.req.param('sprint_id'));
  const rollup = computeSprintRollup(sprintId);
  if (!rollup) return c.json({ error: 'Sprint not found' }, 404);
  return c.json(rollup);
});

function computeSprintRollup(sprintId: number) {
  // Verify sprint exists
  const sprint = db.prepare('SELECT id, capacity FROM sprints WHERE id = ?').get(sprintId) as any;
  if (!sprint) return null;

  // Get issue counts by status for this sprint
  const statusCounts = db.prepare(`
    SELECT 
      status,
      COUNT(*) as count,
      COALESCE(SUM(estimate), 0) as points
    FROM issues 
    WHERE sprint_id = ?
    GROUP BY status
  `).all(sprintId) as any[];

  // Initialize counts
  let totalIssues = 0;
  let totalPoints = 0;
  let completedPoints = 0;
  let backlogCount = 0;
  let todoCount = 0;
  let inprogressCount = 0;
  let inreviewCount = 0;
  let doneCount = 0;

  // Process status counts
  for (const row of statusCounts) {
    totalIssues += row.count;
    totalPoints += row.points;
    
    switch (row.status) {
      case 'backlog':
        backlogCount = row.count;
        break;
      case 'todo':
        todoCount = row.count;
        break;
      case 'inprogress':
        inprogressCount = row.count;
        break;
      case 'inreview':
        inreviewCount = row.count;
        break;
      case 'done':
        doneCount = row.count;
        completedPoints += row.points;
        break;
    }
  }

  const pointsRemaining = totalPoints - completedPoints;
  const percentComplete = totalPoints > 0 ? (completedPoints / totalPoints) * 100 : 0;

  // Check capacity
  const isOverCapacity = totalPoints > sprint.capacity;
  const capacityExceededBy = isOverCapacity ? totalPoints - sprint.capacity : 0;

  return {
    sprint_id: sprintId,
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
    is_over_capacity: isOverCapacity,
    capacity_exceeded_by: capacityExceededBy,
  };
}

/** @internal Phoenix VCS traceability — do not remove. */

/** @internal Phoenix VCS traceability — do not remove. */


export default router;

/** @internal Phoenix VCS traceability — do not remove. */
export const _phoenix = {
  iu_id: 'd316d83ecbe26aff79369e7ea7b451c3322da29a5a797c9ef6d96b0a39173278',
  name: 'Sprint rollup',
  risk_tier: 'low',
  canon_ids: [3 as const],
} as const;
