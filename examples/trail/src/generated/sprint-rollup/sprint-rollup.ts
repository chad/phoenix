import { Hono } from 'hono';
import { db, registerMigration } from '../../db.js';
import { z } from 'zod';

// ─── Database migrations ────────────────────────────────────────────────────

// ─── Database migrations ────────────────────────────────────────────────────

registerMigration('sprint_rollup', `
  CREATE TABLE IF NOT EXISTS sprint_rollup (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sprint_id INTEGER NOT NULL UNIQUE,
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
    over_capacity_by INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )
`);

// ─── Schemas ────────────────────────────────────────────────────────────────

const RollupSchema = z.object({
  sprint_id: z.number().int(),
  total_issues: z.number().int(),
  total_points: z.number().int(),
  completed_points: z.number().int(),
  points_remaining: z.number().int(),
  completion_percentage: z.number(),
  backlog_count: z.number().int(),
  todo_count: z.number().int(),
  inprogress_count: z.number().int(),
  inreview_count: z.number().int(),
  done_count: z.number().int(),
  is_over_capacity: z.boolean(),
  over_capacity_by: z.number().int(),
});

// ─── Routes ─────────────────────────────────────────────────────────────────

const router = new Hono();

router.get('/', (c) => {
  const sprintId = c.req.query('sprint_id');
  if (!sprintId) return c.json({ error: 'sprint_id parameter required' }, 400);
  
  const rollup = computeSprintRollup(Number(sprintId));
  return c.json(rollup);
});

router.get('/:sprint_id', (c) => {
  const sprintId = Number(c.req.param('sprint_id'));
  const rollup = computeSprintRollup(sprintId);
  return c.json(rollup);
});

function computeSprintRollup(sprintId: number) {
  // Get sprint capacity
  const sprint = db.prepare('SELECT capacity FROM sprints WHERE id = ?').get(sprintId) as { capacity: number } | undefined;
  const capacity = sprint?.capacity || 0;

  // Get issue counts by status
  const statusCounts = db.prepare(`
    SELECT 
      status,
      COUNT(*) as count,
      COALESCE(SUM(point_estimate), 0) as points
    FROM issues 
    WHERE sprint_id = ? 
    GROUP BY status
  `).all(sprintId) as Array<{ status: string; count: number; points: number }>;

  // Initialize counts
  let totalIssues = 0;
  let totalPoints = 0;
  let completedPoints = 0;
  const statusBreakdown = {
    backlog_count: 0,
    todo_count: 0,
    inprogress_count: 0,
    inreview_count: 0,
    done_count: 0,
  };

  // Process status counts
  for (const row of statusCounts) {
    totalIssues += row.count;
    totalPoints += row.points;
    
    if (row.status === 'done') {
      completedPoints += row.points;
    }
    
    switch (row.status) {
      case 'backlog': statusBreakdown.backlog_count = row.count; break;
      case 'todo': statusBreakdown.todo_count = row.count; break;
      case 'inprogress': statusBreakdown.inprogress_count = row.count; break;
      case 'inreview': statusBreakdown.inreview_count = row.count; break;
      case 'done': statusBreakdown.done_count = row.count; break;
    }
  }

  const pointsRemaining = totalPoints - completedPoints;
  const completionPercentage = totalPoints > 0 ? (completedPoints / totalPoints) * 100 : 0;
  
  // Check capacity
  const isOverCapacity = totalPoints > capacity;
  const overCapacityBy = isOverCapacity ? totalPoints - capacity : 0;

  return {
    sprint_id: sprintId,
    total_issues: totalIssues,
    total_points: totalPoints,
    completed_points: completedPoints,
    points_remaining: pointsRemaining,
    completion_percentage: Math.round(completionPercentage * 100) / 100,
    ...statusBreakdown,
    is_over_capacity: isOverCapacity,
    over_capacity_by: overCapacityBy,
  };
}



export default router;

/** @internal Phoenix VCS traceability — do not remove. */
export const _phoenix = {
  iu_id: 'd7fb39d4bab213da560a66643474b952db5c4f863294fb422e12ed2f6e776a30',
  name: 'sprint rollup',
  risk_tier: 'low',
  canon_ids: [3 as const],
} as const;
