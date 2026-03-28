import { Hono } from 'hono';
import { db, registerMigration } from '../../db.js';
import { z } from 'zod';

// Register migrations for tasks and projects tables
registerMigration('projects', `
  CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    color TEXT NOT NULL DEFAULT '#3b82f6',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )
`);

registerMigration('tasks', `
  CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('urgent', 'high', 'normal', 'low')),
    due_date TEXT,
    completed INTEGER NOT NULL DEFAULT 0,
    project_id INTEGER REFERENCES projects(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )
`);

const CreateTaskSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().optional().default(''),
  priority: z.enum(['urgent', 'high', 'normal', 'low']).optional().default('normal'),
  due_date: z.string().nullable().optional(),
  project_id: z.number().int().nullable().optional(),
});

const UpdateTaskSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().optional(),
  priority: z.enum(['urgent', 'high', 'normal', 'low']).optional(),
  due_date: z.string().nullable().optional(),
  completed: z.number().int().min(0).max(1).optional(),
  project_id: z.number().int().nullable().optional(),
});

const CreateProjectSchema = z.object({
  name: z.string().min(1).max(100),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional().default('#3b82f6'),
});

const UpdateProjectSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
});

const router = new Hono();

// Tasks endpoints
router.get('/tasks', (c) => {
  let sql = `
    SELECT tasks.*, projects.name as project_name, projects.color as project_color
    FROM tasks 
    LEFT JOIN projects ON tasks.project_id = projects.id
  `;
  const conditions: string[] = [];
  const params: (string | number)[] = [];

  const status = c.req.query('status');
  if (status === 'active') { conditions.push('tasks.completed = 0'); }
  else if (status === 'completed') { conditions.push('tasks.completed = 1'); }

  const priority = c.req.query('priority');
  if (priority) { conditions.push('tasks.priority = ?'); params.push(priority); }

  const projectId = c.req.query('project_id');
  if (projectId) { conditions.push('tasks.project_id = ?'); params.push(Number(projectId)); }

  if (conditions.length > 0) sql += ' WHERE ' + conditions.join(' AND ');
  
  sql += ` ORDER BY 
    CASE tasks.priority 
      WHEN 'urgent' THEN 0 
      WHEN 'high' THEN 1 
      WHEN 'normal' THEN 2 
      WHEN 'low' THEN 3 
    END,
    CASE 
      WHEN tasks.due_date IS NOT NULL AND tasks.due_date < date('now') AND tasks.completed = 0 THEN 0
      ELSE 1
    END,
    tasks.created_at DESC
  `;

  return c.json(db.prepare(sql).all(...params));
});

router.get('/tasks/:id', (c) => {
  const task = db.prepare(`
    SELECT tasks.*, projects.name as project_name, projects.color as project_color
    FROM tasks 
    LEFT JOIN projects ON tasks.project_id = projects.id 
    WHERE tasks.id = ?
  `).get(c.req.param('id'));
  if (!task) return c.json({ error: 'Task not found' }, 404);
  return c.json(task);
});

router.post('/tasks', async (c) => {
  let body;
  try { body = await c.req.json(); } 
  catch { return c.json({ error: 'Invalid JSON' }, 400); }
  
  const result = CreateTaskSchema.safeParse(body);
  if (!result.success) return c.json({ error: result.error.issues[0].message }, 400);
  
  const { title, description, priority, due_date, project_id } = result.data;
  
  if (project_id !== null && project_id !== undefined) {
    const project = db.prepare('SELECT id FROM projects WHERE id = ?').get(project_id);
    if (!project) return c.json({ error: 'Project not found' }, 400);
  }
  
  const info = db.prepare(`
    INSERT INTO tasks (title, description, priority, due_date, project_id) 
    VALUES (?, ?, ?, ?, ?)
  `).run(title, description, priority, due_date, project_id);
  
  const task = db.prepare(`
    SELECT tasks.*, projects.name as project_name, projects.color as project_color
    FROM tasks 
    LEFT JOIN projects ON tasks.project_id = projects.id 
    WHERE tasks.id = ?
  `).get(info.lastInsertRowid);
  
  return c.json(task, 201);
});

router.patch('/tasks/:id', async (c) => {
  const id = c.req.param('id');
  const existing = db.prepare('SELECT id FROM tasks WHERE id = ?').get(id);
  if (!existing) return c.json({ error: 'Task not found' }, 404);
  
  let body;
  try { body = await c.req.json(); } 
  catch { return c.json({ error: 'Invalid JSON' }, 400); }
  
  const result = UpdateTaskSchema.safeParse(body);
  if (!result.success) return c.json({ error: result.error.issues[0].message }, 400);
  
  const updates = result.data;
  
  if (updates.project_id !== undefined && updates.project_id !== null) {
    const project = db.prepare('SELECT id FROM projects WHERE id = ?').get(updates.project_id);
    if (!project) return c.json({ error: 'Project not found' }, 400);
  }
  
  if (updates.title !== undefined) db.prepare('UPDATE tasks SET title = ?, updated_at = datetime("now") WHERE id = ?').run(updates.title, id);
  if (updates.description !== undefined) db.prepare('UPDATE tasks SET description = ?, updated_at = datetime("now") WHERE id = ?').run(updates.description, id);
  if (updates.priority !== undefined) db.prepare('UPDATE tasks SET priority = ?, updated_at = datetime("now") WHERE id = ?').run(updates.priority, id);
  if (updates.due_date !== undefined) db.prepare('UPDATE tasks SET due_date = ?, updated_at = datetime("now") WHERE id = ?').run(updates.due_date, id);
  if (updates.completed !== undefined) db.prepare('UPDATE tasks SET completed = ?, updated_at = datetime("now") WHERE id = ?').run(updates.completed, id);
  if (updates.project_id !== undefined) db.prepare('UPDATE tasks SET project_id = ?, updated_at = datetime("now") WHERE id = ?').run(updates.project_id, id);
  
  const updated = db.prepare(`
    SELECT tasks.*, projects.name as project_name, projects.color as project_color
    FROM tasks 
    LEFT JOIN projects ON tasks.project_id = projects.id 
    WHERE tasks.id = ?
  `).get(id);
  
  return c.json(updated);
});

router.delete('/tasks/:id', (c) => {
  const id = c.req.param('id');
  const existing = db.prepare('SELECT id FROM tasks WHERE id = ?').get(id);
  if (!existing) return c.json({ error: 'Task not found' }, 404);
  
  db.prepare('DELETE FROM tasks WHERE id = ?').run(id);
  return c.body(null, 204);
});

// Projects endpoints
router.get('/projects', (c) => {
  const projects = db.prepare(`
    SELECT projects.*, 
           COUNT(CASE WHEN tasks.completed = 0 THEN 1 END) as active_task_count
    FROM projects 
    LEFT JOIN tasks ON projects.id = tasks.project_id 
    GROUP BY projects.id 
    ORDER BY projects.created_at DESC
  `).all();
  return c.json(projects);
});

router.get('/projects/:id', (c) => {
  const project = db.prepare(`
    SELECT projects.*, 
           COUNT(CASE WHEN tasks.completed = 0 THEN 1 END) as active_task_count
    FROM projects 
    LEFT JOIN tasks ON projects.id = tasks.project_id 
    WHERE projects.id = ?
    GROUP BY projects.id
  `).get(c.req.param('id'));
  if (!project) return c.json({ error: 'Project not found' }, 404);
  return c.json(project);
});

router.post('/projects', async (c) => {
  let body;
  try { body = await c.req.json(); } 
  catch { return c.json({ error: 'Invalid JSON' }, 400); }
  
  const result = CreateProjectSchema.safeParse(body);
  if (!result.success) return c.json({ error: result.error.issues[0].message }, 400);
  
  const { name, color } = result.data;
  
  try {
    const info = db.prepare('INSERT INTO projects (name, color) VALUES (?, ?)').run(name, color);
    const project = db.prepare(`
      SELECT projects.*, 
             COUNT(CASE WHEN tasks.completed = 0 THEN 1 END) as active_task_count
      FROM projects 
      LEFT JOIN tasks ON projects.id = tasks.project_id 
      WHERE projects.id = ?
      GROUP BY projects.id
    `).get(info.lastInsertRowid);
    return c.json(project, 201);
  } catch (error: unknown) {
    if (error instanceof Error && 'code' in error && (error as any).code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return c.json({ error: 'Project name already exists' }, 400);
    }
    throw error;
  }
});

router.patch('/projects/:id', async (c) => {
  const id = c.req.param('id');
  const existing = db.prepare('SELECT id FROM projects WHERE id = ?').get(id);
  if (!existing) return c.json({ error: 'Project not found' }, 404);
  
  let body;
  try { body = await c.req.json(); } 
  catch { return c.json({ error: 'Invalid JSON' }, 400); }
  
  const result = UpdateProjectSchema.safeParse(body);
  if (!result.success) return c.json({ error: result.error.issues[0].message }, 400);
  
  const updates = result.data;
  
  try {
    if (updates.name !== undefined) db.prepare('UPDATE projects SET name = ? WHERE id = ?').run(updates.name, id);
    if (updates.color !== undefined) db.prepare('UPDATE projects SET color = ? WHERE id = ?').run(updates.color, id);
    
    const updated = db.prepare(`
      SELECT projects.*, 
             COUNT(CASE WHEN tasks.completed = 0 THEN 1 END) as active_task_count
      FROM projects 
      LEFT JOIN tasks ON projects.id = tasks.project_id 
      WHERE projects.id = ?
      GROUP BY projects.id
    `).get(id);
    
    return c.json(updated);
  } catch (error: unknown) {
    if (error instanceof Error && 'code' in error && (error as any).code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return c.json({ error: 'Project name already exists' }, 400);
    }
    throw error;
  }
});

router.delete('/projects/:id', (c) => {
  const id = c.req.param('id');
  const existing = db.prepare('SELECT id FROM projects WHERE id = ?').get(id);
  if (!existing) return c.json({ error: 'Project not found' }, 404);
  
  const dependentTasks = db.prepare('SELECT COUNT(*) as count FROM tasks WHERE project_id = ?').get(id) as { count: number };
  if (dependentTasks.count > 0) {
    return c.json({ error: 'Cannot delete project with existing tasks' }, 400);
  }
  
  db.prepare('DELETE FROM projects WHERE id = ?').run(id);
  return c.body(null, 204);
});

export default router;

/** @internal Phoenix VCS traceability — do not remove. */
export const _phoenix = {
  iu_id: '7ee19d155ffb4b7ff0346e313207867d19efacb2af2bfcb3dce82a7f2adfd73f',
  name: 'Integration',
  risk_tier: 'low',
  canon_ids: [3 as const],
} as const;