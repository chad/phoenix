import { Hono } from 'hono';
import { db, registerMigration } from '../../db.js';
import { z } from 'zod';

// Register table migrations for tasks and projects
registerMigration('projects', `
  CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    color TEXT NOT NULL DEFAULT '#3b82f6',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )
`);

registerMigration('tasks', `
  CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT DEFAULT '',
    priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('urgent', 'high', 'normal', 'low')),
    due_date TEXT,
    completed INTEGER NOT NULL DEFAULT 0,
    project_id INTEGER REFERENCES projects(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )
`);

const router = new Hono();

// Get stats summary
router.get('/', (c) => {
  const totalTasks = db.prepare('SELECT COUNT(*) as count FROM tasks').get() as { count: number };
  
  const completedTasks = db.prepare('SELECT COUNT(*) as count FROM tasks WHERE completed = 1').get() as { count: number };
  
  const overdueTasks = db.prepare('SELECT COUNT(*) as count FROM tasks WHERE due_date < date("now") AND completed = 0').get() as { count: number };
  
  const completionPercentage = totalTasks.count > 0 
    ? Math.round((completedTasks.count / totalTasks.count) * 100)
    : 0;

  return c.json({
    total_tasks: totalTasks.count,
    completed_tasks: completedTasks.count,
    overdue_tasks: overdueTasks.count,
    completion_percentage: completionPercentage
  });
});

export default router;

/** @internal Phoenix VCS traceability — do not remove. */
export const _phoenix = {
  iu_id: 'e971f2b7f67c9ac5f5b54f0baf9d19f5e50593b2fc1e9f9c93fb01f6029e712e',
  name: 'Quick Stats',
  risk_tier: 'low',
  canon_ids: [2 as const],
} as const;