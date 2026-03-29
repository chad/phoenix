import { Hono } from 'hono';
import { db, registerMigration } from '../../db.js';
import { z } from 'zod';

// ─── Database migrations ────────────────────────────────────────────────────

// ─── Database migrations ────────────────────────────────────────────────────

registerMigration('tasks', `
  CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    priority TEXT NOT NULL DEFAULT 'normal',
    due_date TEXT,
    completed INTEGER NOT NULL DEFAULT 0,
    project_id INTEGER REFERENCES projects(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )
`);

// ─── Schemas ────────────────────────────────────────────────────────────────

const CreateTaskSchema = z.object({
  title: z.string().min(1, 'Title is required').max(500, 'Title must not exceed 500 characters'),
  description: z.string().max(5000, 'Description must not exceed 5000 characters').optional().default(''),
  priority: z.enum(['urgent', 'high', 'normal', 'low']).optional().default('normal'),
  due_date: z.string().refine((date) => {
    if (!date) return true;
    const parsed = new Date(date);
    return !isNaN(parsed.getTime());
  }, 'Invalid date format').nullable().optional(),
  project_id: z.number().int().nullable().optional(),
});

const UpdateTaskSchema = z.object({
  title: z.string().min(1, 'Title is required').max(500, 'Title must not exceed 500 characters').optional(),
  description: z.string().max(5000, 'Description must not exceed 5000 characters').optional(),
  priority: z.enum(['urgent', 'high', 'normal', 'low']).optional(),
  due_date: z.string().refine((date) => {
    if (!date) return true;
    const parsed = new Date(date);
    return !isNaN(parsed.getTime());
  }, 'Invalid date format').nullable().optional(),
  completed: z.boolean().optional(),
  project_id: z.number().int().nullable().optional(),
});

// ─── Routes ─────────────────────────────────────────────────────────────────

const router = new Hono();

router.get('/', (c) => {
  let sql = 'SELECT tasks.*, projects.name as project_name FROM tasks LEFT JOIN projects ON tasks.project_id = projects.id';
  const conditions: string[] = [];
  const params: any[] = [];
  
  const status = c.req.query('status');
  if (status === 'active') { conditions.push('tasks.completed = 0'); }
  else if (status === 'completed') { conditions.push('tasks.completed = 1'); }
  
  const projectId = c.req.query('project_id');
  if (projectId !== undefined) { 
    if (projectId === 'null') {
      conditions.push('tasks.project_id IS NULL');
    } else {
      conditions.push('tasks.project_id = ?'); 
      params.push(Number(projectId)); 
    }
  }
  
  const priority = c.req.query('priority');
  if (priority !== undefined) { conditions.push('tasks.priority = ?'); params.push(priority); }
  
  if (conditions.length > 0) sql += ' WHERE ' + conditions.join(' AND ');
  
  // Order by priority (urgent first), then overdue, then due date, then created date
  sql += ` ORDER BY 
    CASE tasks.priority 
      WHEN 'urgent' THEN 1 
      WHEN 'high' THEN 2 
      WHEN 'normal' THEN 3 
      WHEN 'low' THEN 4 
    END,
    CASE 
      WHEN tasks.due_date IS NOT NULL AND tasks.due_date < datetime('now') THEN 1 
      ELSE 2 
    END,
    tasks.due_date ASC,
    tasks.created_at DESC`;
  
  return c.json(db.prepare(sql).all(...params));
});

router.get('/stats', (c) => {
  const projectId = c.req.query('project_id');
  let whereClause = '';
  const params: any[] = [];
  
  if (projectId !== undefined) {
    if (projectId === 'null') {
      whereClause = ' WHERE project_id IS NULL';
    } else {
      whereClause = ' WHERE project_id = ?';
      params.push(Number(projectId));
    }
  }
  
  const totalTasks = db.prepare(`SELECT COUNT(*) as count FROM tasks${whereClause}`).get(...params) as { count: number };
  const completedTasks = db.prepare(`SELECT COUNT(*) as count FROM tasks${whereClause ? whereClause + ' AND' : ' WHERE'} completed = 1`).get(...params) as { count: number };
  const overdueTasks = db.prepare(`SELECT COUNT(*) as count FROM tasks${whereClause ? whereClause + ' AND' : ' WHERE'} due_date IS NOT NULL AND due_date < datetime('now') AND completed = 0`).get(...params) as { count: number };
  
  const completionPercentage = totalTasks.count > 0 ? Math.round((completedTasks.count / totalTasks.count) * 100) : 0;
  
  return c.json({
    total_tasks: totalTasks.count,
    completed_tasks: completedTasks.count,
    overdue_tasks: overdueTasks.count,
    completion_percentage: completionPercentage
  });
});

router.get('/:id', (c) => {
  const task = db.prepare('SELECT tasks.*, projects.name as project_name FROM tasks LEFT JOIN projects ON tasks.project_id = projects.id WHERE tasks.id = ?').get(c.req.param('id'));
  if (!task) return c.json({ error: 'Not found' }, 404);
  return c.json(task);
});

router.post('/', async (c) => {
  let body; try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }
  const result = CreateTaskSchema.safeParse(body);
  if (!result.success) return c.json({ error: result.error.issues[0].message }, 400);
  
  const { title, description, priority, due_date, project_id } = result.data;
  
  if (project_id != null) {
    if (!db.prepare('SELECT id FROM projects WHERE id = ?').get(project_id)) {
      return c.json({ error: 'Project not found' }, 400);
    }
  }
  
  const info = db.prepare('INSERT INTO tasks (title, description, priority, due_date, project_id) VALUES (?, ?, ?, ?, ?)').run(
    title, description, priority, due_date ?? null, project_id ?? null
  );
  
  const task = db.prepare('SELECT tasks.*, projects.name as project_name FROM tasks LEFT JOIN projects ON tasks.project_id = projects.id WHERE tasks.id = ?').get(info.lastInsertRowid);
  return c.json(task, 201);
});

router.patch('/:id', async (c) => {
  const id = c.req.param('id');
  if (!db.prepare('SELECT id FROM tasks WHERE id = ?').get(id)) return c.json({ error: 'Not found' }, 404);
  
  let body; try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }
  const result = UpdateTaskSchema.safeParse(body);
  if (!result.success) return c.json({ error: result.error.issues[0].message }, 400);
  
  const u = result.data;
  
  if (u.project_id !== undefined && u.project_id != null) {
    if (!db.prepare('SELECT id FROM projects WHERE id = ?').get(u.project_id)) {
      return c.json({ error: 'Project not found' }, 400);
    }
  }
  
  if (u.title !== undefined) db.prepare('UPDATE tasks SET title = ? WHERE id = ?').run(u.title, id);
  if (u.description !== undefined) db.prepare('UPDATE tasks SET description = ? WHERE id = ?').run(u.description, id);
  if (u.priority !== undefined) db.prepare('UPDATE tasks SET priority = ? WHERE id = ?').run(u.priority, id);
  if (u.due_date !== undefined) db.prepare('UPDATE tasks SET due_date = ? WHERE id = ?').run(u.due_date, id);
  if (u.completed !== undefined) db.prepare('UPDATE tasks SET completed = ? WHERE id = ?').run(u.completed ? 1 : 0, id);
  if (u.project_id !== undefined) db.prepare('UPDATE tasks SET project_id = ? WHERE id = ?').run(u.project_id, id);
  
  const task = db.prepare('SELECT tasks.*, projects.name as project_name FROM tasks LEFT JOIN projects ON tasks.project_id = projects.id WHERE tasks.id = ?').get(id);
  return c.json(task);
});

router.delete('/:id', (c) => {
  const id = c.req.param('id');
  if (!db.prepare('SELECT id FROM tasks WHERE id = ?').get(id)) return c.json({ error: 'Not found' }, 404);
  db.prepare('DELETE FROM tasks WHERE id = ?').run(id);
  return c.body(null, 204);
});

/** @internal Phoenix VCS traceability — do not remove. */

/** @internal Phoenix VCS traceability — do not remove. */


export default router;

/** @internal Phoenix VCS traceability — do not remove. */
export const _phoenix = {
  iu_id: 'd1674e8728d267b9ec1f7b60a9e428563ea08a93541b51d4532626483ce2b423',
  name: 'Tasks',
  risk_tier: 'high',
  canon_ids: [14 as const],
} as const;
