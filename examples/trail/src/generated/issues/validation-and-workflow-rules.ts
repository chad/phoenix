import { Hono } from 'hono';
import { db, registerMigration } from '../../db.js';
import { z } from 'zod';

// ─── Database migrations ────────────────────────────────────────────────────

const router = new Hono();

registerMigration('issues', `
  CREATE TABLE IF NOT EXISTS issues (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'backlog',
    priority TEXT NOT NULL DEFAULT 'normal',
    point_estimate INTEGER,
    assignee TEXT,
    labels TEXT NOT NULL DEFAULT '[]',
    sprint_id INTEGER,
    completed_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )
`);

const CreateIssueSchema = z.object({
  title: z.string().min(1, 'Title cannot be empty').max(200, 'Title must not exceed 200 characters'),
  description: z.string().max(5000, 'Description must not exceed 5000 characters').optional().default(''),
  status: z.enum(['backlog', 'todo', 'inprogress', 'inreview', 'done']).optional().default('backlog'),
  priority: z.enum(['urgent', 'high', 'normal', 'low']).optional().default('normal'),
  point_estimate: z.enum([1, 2, 3, 5, 8, 13]).nullable().optional(),
  assignee: z.string().nullable().optional(),
  labels: z.array(z.string().max(24, 'Label must not exceed 24 characters')).max(8, 'Issue must not contain more than 8 labels').optional().default([]),
  sprint_id: z.number().int().nullable().optional(),
});

const UpdateIssueSchema = z.object({
  title: z.string().min(1, 'Title cannot be empty').max(200, 'Title must not exceed 200 characters').optional(),
  description: z.string().max(5000, 'Description must not exceed 5000 characters').optional(),
  status: z.enum(['backlog', 'todo', 'inprogress', 'inreview', 'done']).optional(),
  priority: z.enum(['urgent', 'high', 'normal', 'low']).optional(),
  point_estimate: z.enum([1, 2, 3, 5, 8, 13]).nullable().optional(),
  assignee: z.string().nullable().optional(),
  labels: z.array(z.string().max(24, 'Label must not exceed 24 characters')).max(8, 'Issue must not contain more than 8 labels').optional(),
  sprint_id: z.number().int().nullable().optional(),
});

router.get('/', (c) => {
  let sql = 'SELECT * FROM issues';
  const conditions: string[] = [];
  const params: unknown[] = [];
  
  const assignee = c.req.query('assignee');
  if (assignee !== undefined) { conditions.push('assignee = ?'); params.push(assignee); }
  
  const status = c.req.query('status');
  if (status !== undefined) { conditions.push('status = ?'); params.push(status); }
  
  const search = c.req.query('search');
  if (search !== undefined) { conditions.push('(title LIKE ? OR description LIKE ?)'); params.push(`%${search}%`, `%${search}%`); }
  
  if (conditions.length > 0) sql += ' WHERE ' + conditions.join(' AND ');
  sql += " ORDER BY CASE priority WHEN 'urgent' THEN 1 WHEN 'high' THEN 2 WHEN 'normal' THEN 3 WHEN 'low' THEN 4 END, updated_at DESC";
  
  const issues = db.prepare(sql).all(...params) as any[];
  return c.json(issues.map(issue => ({ ...issue, labels: JSON.parse(issue.labels) })));
});

router.get('/:id', (c) => {
  const issue = db.prepare('SELECT * FROM issues WHERE id = ?').get(c.req.param('id')) as any;
  if (!issue) return c.json({ error: 'Not found' }, 404);
  return c.json({ ...issue, labels: JSON.parse(issue.labels) });
});

router.post('/', async (c) => {
  let body; try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }
  const result = CreateIssueSchema.safeParse(body);
  if (!result.success) return c.json({ error: result.error.issues[0].message }, 400);
  
  const { title, description, status, priority, point_estimate, assignee, labels, sprint_id } = result.data;
  
  // Check for duplicate labels
  if (labels && new Set(labels).size !== labels.length) {
    return c.json({ error: 'Issue must not contain duplicate labels' }, 400);
  }
  
  const info = db.prepare("INSERT INTO issues (title, description, status, priority, point_estimate, assignee, labels, sprint_id, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))").run(
    title, description, status, priority, point_estimate ?? null, assignee ?? null, JSON.stringify(labels), sprint_id ?? null
  );
  
  const issue = db.prepare('SELECT * FROM issues WHERE id = ?').get(info.lastInsertRowid) as any;
  return c.json({ ...issue, labels: JSON.parse(issue.labels) }, 201);
});

router.patch('/:id', async (c) => {
  const id = c.req.param('id');
  const currentIssue = db.prepare('SELECT * FROM issues WHERE id = ?').get(id) as any;
  if (!currentIssue) return c.json({ error: 'Not found' }, 404);
  
  let body; try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }
  const result = UpdateIssueSchema.safeParse(body);
  if (!result.success) return c.json({ error: result.error.issues[0].message }, 400);
  
  const u = result.data;
  
  // Check for duplicate labels
  if (u.labels && new Set(u.labels).size !== u.labels.length) {
    return c.json({ error: 'Issue must not contain duplicate labels' }, 400);
  }
  
  // Validate status transitions
  if (u.status !== undefined) {
    const currentStatus = currentIssue.status;
    const newStatus = u.status;
    const statusOrder = ['backlog', 'todo', 'inprogress', 'inreview', 'done'];
    const currentIndex = statusOrder.indexOf(currentStatus);
    const newIndex = statusOrder.indexOf(newStatus);
    
    // Allow moving to backlog from any status, one step forward/backward, or staying same
    if (newStatus !== 'backlog' && newStatus !== currentStatus && Math.abs(newIndex - currentIndex) !== 1) {
      return c.json({ error: 'Invalid status transition' }, 400);
    }
    
    // Cannot move out of backlog without point estimate
    if (currentStatus === 'backlog' && newStatus !== 'backlog' && !currentIssue.point_estimate) {
      return c.json({ error: 'Cannot move issue out of backlog without point estimate' }, 400);
    }
  }
  
  // Update fields
  if (u.title !== undefined) db.prepare("UPDATE issues SET title = ?, updated_at = datetime('now') WHERE id = ?").run(u.title, id);
  if (u.description !== undefined) db.prepare("UPDATE issues SET description = ?, updated_at = datetime('now') WHERE id = ?").run(u.description, id);
  if (u.priority !== undefined) db.prepare("UPDATE issues SET priority = ?, updated_at = datetime('now') WHERE id = ?").run(u.priority, id);
  if (u.point_estimate !== undefined) db.prepare("UPDATE issues SET point_estimate = ?, updated_at = datetime('now') WHERE id = ?").run(u.point_estimate, id);
  if (u.assignee !== undefined) db.prepare("UPDATE issues SET assignee = ?, updated_at = datetime('now') WHERE id = ?").run(u.assignee, id);
  if (u.labels !== undefined) db.prepare("UPDATE issues SET labels = ?, updated_at = datetime('now') WHERE id = ?").run(JSON.stringify(u.labels), id);
  if (u.sprint_id !== undefined) db.prepare("UPDATE issues SET sprint_id = ?, updated_at = datetime('now') WHERE id = ?").run(u.sprint_id, id);
  
  if (u.status !== undefined) {
    // Handle completion timestamp
    if (u.status === 'done' && currentIssue.status !== 'done') {
      db.prepare("UPDATE issues SET status = ?, completed_at = datetime('now'), updated_at = datetime('now') WHERE id = ?").run(u.status, id);
    } else if (u.status !== 'done' && currentIssue.status === 'done') {
      db.prepare("UPDATE issues SET status = ?, completed_at = NULL, updated_at = datetime('now') WHERE id = ?").run(u.status, id);
    } else {
      db.prepare("UPDATE issues SET status = ?, updated_at = datetime('now') WHERE id = ?").run(u.status, id);
    }
  }
  
  const issue = db.prepare('SELECT * FROM issues WHERE id = ?').get(id) as any;
  return c.json({ ...issue, labels: JSON.parse(issue.labels) });
});

router.delete('/:id', (c) => {
  const id = c.req.param('id');
  if (!db.prepare('SELECT id FROM issues WHERE id = ?').get(id)) return c.json({ error: 'Not found' }, 404);
  db.prepare('DELETE FROM issues WHERE id = ?').run(id);
  return c.body(null, 204);
});



export default router;

/** @internal Phoenix VCS traceability — do not remove. */
export const _phoenix = {
  iu_id: 'a980a1f50d33170c97ca0086d5a04cd5aa03f820cd0e0fdee2d77640a79454bf',
  name: 'Validation and workflow rules',
  risk_tier: 'high',
  canon_ids: [11 as const],
} as const;
