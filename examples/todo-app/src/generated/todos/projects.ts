import { Hono } from 'hono';
import { db, registerMigration } from '../../db.js';
import { z } from 'zod';

// ─── Database migrations ────────────────────────────────────────────────────

// ─── Database migrations ────────────────────────────────────────────────────

registerMigration('projects', `
  CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    color TEXT NOT NULL DEFAULT '#3b82f6',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )
`);

// ─── Schemas ────────────────────────────────────────────────────────────────

const CreateProjectSchema = z.object({
  name: z.string().min(1).max(200),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional().default('#3b82f6'),
});

const UpdateProjectSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
});

// ─── Routes ─────────────────────────────────────────────────────────────────

const router = new Hono();

router.get('/', (c) => {
  const projects = db.prepare(`
    SELECT 
      projects.*,
      COUNT(CASE WHEN tasks.completed = 0 THEN 1 END) as active_task_count
    FROM projects 
    LEFT JOIN tasks ON projects.id = tasks.project_id 
    GROUP BY projects.id 
    ORDER BY projects.created_at DESC
  `).all();
  return c.json(projects);
});

router.get('/:id', (c) => {
  const project = db.prepare(`
    SELECT 
      projects.*,
      COUNT(CASE WHEN tasks.completed = 0 THEN 1 END) as active_task_count
    FROM projects 
    LEFT JOIN tasks ON projects.id = tasks.project_id 
    WHERE projects.id = ?
    GROUP BY projects.id
  `).get(c.req.param('id'));
  if (!project) return c.json({ error: 'Not found' }, 404);
  return c.json(project);
});

router.post('/', async (c) => {
  let body; try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }
  const result = CreateProjectSchema.safeParse(body);
  if (!result.success) return c.json({ error: result.error.issues[0].message }, 400);
  const { name, color } = result.data;
  const info = db.prepare('INSERT INTO projects (name, color) VALUES (?, ?)').run(name, color);
  const project = db.prepare(`
    SELECT 
      projects.*,
      COUNT(CASE WHEN tasks.completed = 0 THEN 1 END) as active_task_count
    FROM projects 
    LEFT JOIN tasks ON projects.id = tasks.project_id 
    WHERE projects.id = ?
    GROUP BY projects.id
  `).get(info.lastInsertRowid);
  return c.json(project, 201);
});

router.patch('/:id', async (c) => {
  const id = c.req.param('id');
  if (!db.prepare('SELECT id FROM projects WHERE id = ?').get(id)) return c.json({ error: 'Not found' }, 404);
  let body; try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }
  const result = UpdateProjectSchema.safeParse(body);
  if (!result.success) return c.json({ error: result.error.issues[0].message }, 400);
  const u = result.data;
  if (u.name !== undefined) db.prepare('UPDATE projects SET name = ? WHERE id = ?').run(u.name, id);
  if (u.color !== undefined) db.prepare('UPDATE projects SET color = ? WHERE id = ?').run(u.color, id);
  const project = db.prepare(`
    SELECT 
      projects.*,
      COUNT(CASE WHEN tasks.completed = 0 THEN 1 END) as active_task_count
    FROM projects 
    LEFT JOIN tasks ON projects.id = tasks.project_id 
    WHERE projects.id = ?
    GROUP BY projects.id
  `).get(id);
  return c.json(project);
});

router.delete('/:id', (c) => {
  const id = c.req.param('id');
  if (!db.prepare('SELECT id FROM projects WHERE id = ?').get(id)) return c.json({ error: 'Not found' }, 404);
  
  // Check if project has any tasks (cascade protection)
  const taskCount = db.prepare('SELECT COUNT(*) as count FROM tasks WHERE project_id = ?').get(id) as { count: number };
  if (taskCount.count > 0) {
    return c.json({ error: 'Cannot delete project with existing tasks' }, 400);
  }
  
  db.prepare('DELETE FROM projects WHERE id = ?').run(id);
  return c.body(null, 204);
});

/** @internal Phoenix VCS traceability — do not remove. */

/** @internal Phoenix VCS traceability — do not remove. */


export default router;

/** @internal Phoenix VCS traceability — do not remove. */
export const _phoenix = {
  iu_id: '85a06deb292fbc006424c2365b05d081f4f92fa2581e04a09ee20cb9f7295067',
  name: 'Projects',
  risk_tier: 'high',
  canon_ids: [6 as const],
} as const;
