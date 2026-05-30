import { Hono } from 'hono';
import { db, registerMigration } from '../../db.js';
import { z } from 'zod';

// ─── Database migrations ────────────────────────────────────────────────────

// ─── Database migrations ────────────────────────────────────────────────────

// ─── Database migrations ────────────────────────────────────────────────────

const router = new Hono();

registerMigration('issues', `
  CREATE TABLE IF NOT EXISTS issues (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT DEFAULT '',
    status TEXT NOT NULL DEFAULT 'backlog',
    priority TEXT NOT NULL DEFAULT 'normal',
    point_estimate INTEGER,
    assignee TEXT,
    labels TEXT DEFAULT '',
    sprint_id INTEGER,
    completed_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )
`);

const CreateIssueSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(5000).nullable().optional(),
  status: z.enum(['backlog', 'todo', 'inprogress', 'inreview', 'done']).optional().default('backlog'),
  priority: z.enum(['urgent', 'high', 'normal', 'low']).optional().default('normal'),
  point_estimate: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(5), z.literal(8), z.literal(13)]).nullable().optional(),
  assignee: z.string().nullable().optional(),
  labels: z.array(z.string().max(24)).max(8).nullable().optional(),
  sprint_id: z.number().int().nullable().optional(),
});

const UpdateIssueSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(5000).nullable().optional(),
  status: z.enum(['backlog', 'todo', 'inprogress', 'inreview', 'done']).optional(),
  priority: z.enum(['urgent', 'high', 'normal', 'low']).optional(),
  point_estimate: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(5), z.literal(8), z.literal(13)]).nullable().optional(),
  assignee: z.string().nullable().optional(),
  labels: z.array(z.string().max(24)).max(8).nullable().optional(),
  sprint_id: z.number().int().nullable().optional(),
});

router.get('/', (c) => {
  let sql = 'SELECT * FROM issues';
  const conditions: string[] = [];
  const params: unknown[] = [];
  
  const status = c.req.query('status');
  if (status !== undefined) { conditions.push('status = ?'); params.push(status); }
  
  const assignee = c.req.query('assignee');
  if (assignee !== undefined) { conditions.push('assignee = ?'); params.push(assignee); }
  
  const label = c.req.query('label');
  if (label !== undefined) { conditions.push('labels LIKE ?'); params.push(`%${label}%`); }
  
  const sprintId = c.req.query('sprint_id');
  if (sprintId !== undefined) { conditions.push('sprint_id = ?'); params.push(Number(sprintId)); }
  
  if (conditions.length > 0) sql += ' WHERE ' + conditions.join(' AND ');
  sql += " ORDER BY CASE priority WHEN 'urgent' THEN 1 WHEN 'high' THEN 2 WHEN 'normal' THEN 3 WHEN 'low' THEN 4 END, updated_at DESC";
  
  const issues = db.prepare(sql).all(...params) as any[];
  return c.json(issues.map((issue) => ({
    ...issue,
    labels: issue.labels ? issue.labels.split(',').filter(Boolean) : []
  })));
});

router.post('/', async (c) => {
  let body; try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }
  const result = CreateIssueSchema.safeParse(body);
  if (!result.success) return c.json({ error: result.error.issues[0].message }, 400);
  
  const { title, description, status, priority, point_estimate, assignee, labels, sprint_id } = result.data;
  
  // Check for duplicate labels
  if (labels && new Set(labels).size !== labels.length) {
    return c.json({ error: 'Duplicate labels not allowed' }, 400);
  }
  
  const labelsStr = labels ? labels.join(',') : '';
  const info = db.prepare('INSERT INTO issues (title, description, status, priority, point_estimate, assignee, labels, sprint_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
    title, description || '', status, priority, point_estimate ?? null, assignee ?? null, labelsStr, sprint_id ?? null
  );
  
  const issue = db.prepare('SELECT * FROM issues WHERE id = ?').get(info.lastInsertRowid) as any;
  return c.json({
    ...issue,
    labels: issue.labels ? issue.labels.split(',').filter(Boolean) : []
  }, 201);
});

router.get('/:id', (c) => {
  const issue = db.prepare('SELECT * FROM issues WHERE id = ?').get(c.req.param('id')) as any;
  if (!issue) return c.json({ error: 'Not found' }, 404);
  return c.json({
    ...issue,
    labels: issue.labels ? issue.labels.split(',').filter(Boolean) : []
  });
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
    return c.json({ error: 'Duplicate labels not allowed' }, 400);
  }
  
  // Status transition validation
  if (u.status !== undefined) {
    const validTransitions: Record<string, string[]> = {
      'backlog': ['todo'],
      'todo': ['backlog', 'inprogress'],
      'inprogress': ['backlog', 'todo', 'inreview'],
      'inreview': ['backlog', 'inprogress', 'done'],
      'done': ['backlog', 'inreview']
    };
    
    if (u.status !== currentIssue.status && !validTransitions[currentIssue.status]?.includes(u.status)) {
      return c.json({ error: 'Invalid status transition' }, 400);
    }
    
    // Cannot move out of backlog without point estimate
    if (currentIssue.status === 'backlog' && u.status !== 'backlog' && !currentIssue.point_estimate) {
      return c.json({ error: 'Cannot move out of backlog without point estimate' }, 400);
    }
  }
  
  if (u.title !== undefined) db.prepare("UPDATE issues SET title = ?, updated_at = datetime('now') WHERE id = ?").run(u.title, id);
  if (u.description !== undefined) db.prepare("UPDATE issues SET description = ?, updated_at = datetime('now') WHERE id = ?").run(u.description, id);
  if (u.status !== undefined) {
    const completedAt = u.status === 'done' && currentIssue.status !== 'done' ? "datetime('now')" : 
                       u.status !== 'done' && currentIssue.status === 'done' ? null : currentIssue.completed_at;
    db.prepare("UPDATE issues SET status = ?, completed_at = ?, updated_at = datetime('now') WHERE id = ?").run(u.status, completedAt, id);
  }
  if (u.priority !== undefined) db.prepare("UPDATE issues SET priority = ?, updated_at = datetime('now') WHERE id = ?").run(u.priority, id);
  if (u.point_estimate !== undefined) db.prepare("UPDATE issues SET point_estimate = ?, updated_at = datetime('now') WHERE id = ?").run(u.point_estimate, id);
  if (u.assignee !== undefined) db.prepare("UPDATE issues SET assignee = ?, updated_at = datetime('now') WHERE id = ?").run(u.assignee, id);
  if (u.labels !== undefined) {
    const labelsStr = u.labels ? u.labels.join(',') : '';
    db.prepare("UPDATE issues SET labels = ?, updated_at = datetime('now') WHERE id = ?").run(labelsStr, id);
  }
  if (u.sprint_id !== undefined) db.prepare("UPDATE issues SET sprint_id = ?, updated_at = datetime('now') WHERE id = ?").run(u.sprint_id, id);
  
  const issue = db.prepare('SELECT * FROM issues WHERE id = ?').get(id) as any;
  return c.json({
    ...issue,
    labels: issue.labels ? issue.labels.split(',').filter(Boolean) : []
  });
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
  iu_id: '81f2a41625ffa635d449537199437aa82bf97dbacc3f22b2af7f4b7934256c03',
  name: 'Issues',
  risk_tier: 'high',
  canon_ids: [15 as const],
} as const;
