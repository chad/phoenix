import { Hono } from 'hono';
import { db } from '../../db.js';
import { z } from 'zod';

const router = new Hono();

const CreateIssueSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(5000).optional().default(''),
  status: z.enum(['backlog', 'todo', 'inprogress', 'inreview', 'done']).optional().default('backlog'),
  priority: z.enum(['urgent', 'high', 'normal', 'low']).optional().default('normal'),
  point_estimate: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(5), z.literal(8), z.literal(13)]).nullable().optional(),
  assignee: z.string().nullable().optional(),
  labels: z.array(z.string().max(24)).max(8).optional().default([]),
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
  let sql = 'SELECT issues.*, sprints.name as sprint_name FROM issues LEFT JOIN sprints ON issues.sprint_id = sprints.id';
  const conditions: string[] = [];
  const params: unknown[] = [];
  
  const sprintId = c.req.query('sprint_id');
  if (sprintId !== undefined) {
    conditions.push('issues.sprint_id = ?');
    params.push(Number(sprintId));
  }
  
  const assignee = c.req.query('assignee');
  if (assignee !== undefined) {
    conditions.push('issues.assignee = ?');
    params.push(assignee);
  }
  
  const status = c.req.query('status');
  if (status !== undefined) {
    conditions.push('issues.status = ?');
    params.push(status);
  }
  
  const search = c.req.query('search');
  if (search !== undefined) {
    conditions.push('(issues.title LIKE ? OR issues.description LIKE ?)');
    params.push(`%${search}%`, `%${search}%`);
  }
  
  if (conditions.length > 0) sql += ' WHERE ' + conditions.join(' AND ');
  sql += " ORDER BY CASE issues.priority WHEN 'urgent' THEN 1 WHEN 'high' THEN 2 WHEN 'normal' THEN 3 WHEN 'low' THEN 4 END, issues.updated_at DESC";
  
  const issues = db.prepare(sql).all(...params) as any[];
  return c.json(issues.map(issue => ({
    ...issue,
    labels: JSON.parse(issue.labels as string)
  })));
});

router.get('/:id', (c) => {
  const issue = db.prepare('SELECT issues.*, sprints.name as sprint_name FROM issues LEFT JOIN sprints ON issues.sprint_id = sprints.id WHERE issues.id = ?').get(c.req.param('id')) as any;
  if (!issue) return c.json({ error: 'Not found' }, 404);
  return c.json({
    ...issue,
    labels: JSON.parse(issue.labels as string)
  });
});

router.post('/', async (c) => {
  let body;
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }
  
  const result = CreateIssueSchema.safeParse(body);
  if (!result.success) return c.json({ error: result.error.issues[0].message }, 400);
  
  const { title, description, status, priority, point_estimate, assignee, labels, sprint_id } = result.data;
  
  // Check for duplicate labels
  if (labels && new Set(labels).size !== labels.length) {
    return c.json({ error: 'Duplicate labels not allowed' }, 400);
  }
  
  if (sprint_id != null) {
    if (!db.prepare('SELECT id FROM sprints WHERE id = ?').get(sprint_id)) {
      return c.json({ error: 'Sprint not found' }, 400);
    }
  }
  
  const labelsJson = JSON.stringify(labels || []);
  const info = db.prepare('INSERT INTO issues (title, description, status, priority, point_estimate, assignee, labels, sprint_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
    title, description, status, priority, point_estimate ?? null, assignee ?? null, labelsJson, sprint_id ?? null
  );
  
  const issue = db.prepare('SELECT issues.*, sprints.name as sprint_name FROM issues LEFT JOIN sprints ON issues.sprint_id = sprints.id WHERE issues.id = ?').get(info.lastInsertRowid) as any;
  return c.json({
    ...issue,
    labels: JSON.parse(issue.labels as string)
  }, 201);
});

router.patch('/:id', async (c) => {
  const id = c.req.param('id');
  const existing = db.prepare('SELECT * FROM issues WHERE id = ?').get(id) as any;
  if (!existing) return c.json({ error: 'Not found' }, 404);
  
  let body;
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }
  
  const result = UpdateIssueSchema.safeParse(body);
  if (!result.success) return c.json({ error: result.error.issues[0].message }, 400);
  
  const u = result.data;
  
  // Check for duplicate labels
  if (u.labels && new Set(u.labels).size !== u.labels.length) {
    return c.json({ error: 'Duplicate labels not allowed' }, 400);
  }
  
  // Status change validation
  if (u.status !== undefined) {
    const currentStatus = existing.status;
    const newStatus = u.status;
    const validTransitions: Record<string, string[]> = {
      'backlog': ['todo'],
      'todo': ['backlog', 'inprogress'],
      'inprogress': ['backlog', 'todo', 'inreview'],
      'inreview': ['backlog', 'inprogress', 'done'],
      'done': ['backlog', 'inreview']
    };
    
    if (newStatus !== currentStatus && !validTransitions[currentStatus]?.includes(newStatus)) {
      return c.json({ error: 'Invalid status transition' }, 400);
    }
    
    // Cannot move out of backlog without point estimate
    if (currentStatus === 'backlog' && newStatus !== 'backlog' && !existing.point_estimate) {
      return c.json({ error: 'Cannot move out of backlog without point estimate' }, 400);
    }
  }
  
  if (u.sprint_id !== undefined && u.sprint_id != null) {
    if (!db.prepare('SELECT id FROM sprints WHERE id = ?').get(u.sprint_id)) {
      return c.json({ error: 'Sprint not found' }, 400);
    }
  }
  
  // Update fields
  if (u.title !== undefined) db.prepare("UPDATE issues SET title = ?, updated_at = datetime('now') WHERE id = ?").run(u.title, id);
  if (u.description !== undefined) db.prepare("UPDATE issues SET description = ?, updated_at = datetime('now') WHERE id = ?").run(u.description ?? '', id);
  if (u.priority !== undefined) db.prepare("UPDATE issues SET priority = ?, updated_at = datetime('now') WHERE id = ?").run(u.priority, id);
  if (u.point_estimate !== undefined) db.prepare("UPDATE issues SET point_estimate = ?, updated_at = datetime('now') WHERE id = ?").run(u.point_estimate, id);
  if (u.assignee !== undefined) db.prepare("UPDATE issues SET assignee = ?, updated_at = datetime('now') WHERE id = ?").run(u.assignee, id);
  if (u.labels !== undefined) db.prepare("UPDATE issues SET labels = ?, updated_at = datetime('now') WHERE id = ?").run(JSON.stringify(u.labels || []), id);
  if (u.sprint_id !== undefined) db.prepare("UPDATE issues SET sprint_id = ?, updated_at = datetime('now') WHERE id = ?").run(u.sprint_id, id);
  
  if (u.status !== undefined) {
    const wasInDone = existing.status === 'done';
    const nowInDone = u.status === 'done';
    
    if (!wasInDone && nowInDone) {
      // Entering done status - set completion timestamp
      db.prepare("UPDATE issues SET status = ?, completed_at = datetime('now'), updated_at = datetime('now') WHERE id = ?").run(u.status, id);
    } else if (wasInDone && !nowInDone) {
      // Leaving done status - clear completion timestamp
      db.prepare("UPDATE issues SET status = ?, completed_at = NULL, updated_at = datetime('now') WHERE id = ?").run(u.status, id);
    } else {
      // Status change but not involving done
      db.prepare("UPDATE issues SET status = ?, updated_at = datetime('now') WHERE id = ?").run(u.status, id);
    }
  }
  
  const issue = db.prepare('SELECT issues.*, sprints.name as sprint_name FROM issues LEFT JOIN sprints ON issues.sprint_id = sprints.id WHERE issues.id = ?').get(id) as any;
  return c.json({
    ...issue,
    labels: JSON.parse(issue.labels as string)
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
  iu_id: 'b2da4c8aac573bd82405271a823883ab62b71c32184918bdfb101f637fcf2309',
  name: 'issue',
  risk_tier: 'high',
  canon_ids: [14 as const],
} as const;
