import { Hono } from 'hono';
import { db, registerMigration } from '../../db.js';
import { z } from 'zod';

// Register table migrations for tasks and projects
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
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )
`);

const FilterSchema = z.object({
  status: z.enum(['all', 'active', 'completed']).optional(),
  project_id: z.string().optional(),
  priority: z.enum(['urgent', 'high', 'normal', 'low']).optional(),
});

const router = new Hono();

// Get filtered tasks with current filter state
router.get('/', (c) => {
  const filterResult = FilterSchema.safeParse({
    status: c.req.query('status'),
    project_id: c.req.query('project_id'),
    priority: c.req.query('priority'),
  });

  if (!filterResult.success) {
    return c.json({ error: 'Invalid filter parameters' }, 400);
  }

  const filters = filterResult.data;
  
  let sql = `
    SELECT 
      tasks.*,
      projects.name as project_name,
      projects.color as project_color,
      CASE 
        WHEN tasks.due_date IS NOT NULL AND tasks.due_date < date('now') AND tasks.completed = 0 
        THEN 1 
        ELSE 0 
      END as is_overdue
    FROM tasks 
    LEFT JOIN projects ON tasks.project_id = projects.id
  `;
  
  const conditions: string[] = [];
  const params: (string | number)[] = [];

  // Status filter
  if (filters.status === 'active') {
    conditions.push('tasks.completed = 0');
  } else if (filters.status === 'completed') {
    conditions.push('tasks.completed = 1');
  }

  // Project filter
  if (filters.project_id) {
    if (filters.project_id === 'inbox') {
      conditions.push('tasks.project_id IS NULL');
    } else {
      conditions.push('tasks.project_id = ?');
      params.push(Number(filters.project_id));
    }
  }

  // Priority filter
  if (filters.priority) {
    conditions.push('tasks.priority = ?');
    params.push(filters.priority);
  }

  if (conditions.length > 0) {
    sql += ' WHERE ' + conditions.join(' AND ');
  }

  // Sort by urgency and overdue status
  sql += ` ORDER BY 
    tasks.completed ASC,
    is_overdue DESC,
    CASE tasks.priority 
      WHEN 'urgent' THEN 0 
      WHEN 'high' THEN 1 
      WHEN 'normal' THEN 2 
      WHEN 'low' THEN 3 
    END ASC,
    tasks.due_date ASC NULLS LAST,
    tasks.created_at DESC
  `;

  const tasks = db.prepare(sql).all(...params);

  // Build current filter state description
  const filterState: string[] = [];
  
  if (filters.status && filters.status !== 'all') {
    filterState.push(`Status: ${filters.status}`);
  }
  
  if (filters.project_id) {
    if (filters.project_id === 'inbox') {
      filterState.push('Project: Inbox');
    } else {
      const project = db.prepare('SELECT name FROM projects WHERE id = ?').get(Number(filters.project_id)) as { name: string } | undefined;
      if (project) {
        filterState.push(`Project: ${project.name}`);
      }
    }
  }
  
  if (filters.priority) {
    filterState.push(`Priority: ${filters.priority}`);
  }

  return c.json({
    tasks,
    filter_state: {
      active_filters: filters,
      description: filterState.length > 0 ? filterState.join(', ') : 'All tasks',
      count: Array.isArray(tasks) ? tasks.length : 0
    }
  });
});

// Get available filter options
router.get('/options', (c) => {
  const projects = db.prepare('SELECT id, name, color FROM projects ORDER BY name').all();
  const priorities = ['urgent', 'high', 'normal', 'low'];
  const statuses = ['all', 'active', 'completed'];

  return c.json({
    projects: [
      { id: 'inbox', name: 'Inbox', color: '#6b7280' },
      ...projects
    ],
    priorities,
    statuses
  });
});

// Clear all filters
router.delete('/filters', (c) => {
  return c.json({
    message: 'Filters cleared',
    redirect_url: '/'
  });
});

export default router;

/** @internal Phoenix VCS traceability — do not remove. */
export const _phoenix = {
  iu_id: 'c986c6a7885993ce90d626af61ecc90d5de2801eac95c0ff99b368e0e90e8bcc',
  name: 'Filtering and Views',
  risk_tier: 'low',
  canon_ids: [2 as const],
} as const;