// AUTO-GENERATED shared artifact: database migrations aggregated across IUs.
// Each region below is OWNED by exactly one Implementation Unit. Editing inside a
// region is drift attributed to that IU; Phoenix regenerates the whole file.
import { registerMigration } from '../db.js';

// <<phx:region iu=d7fb39d4bab213da560a66643474b952db5c4f863294fb422e12ed2f6e776a30 role=migration key=sprint_rollup>>
registerMigration('sprint_rollup', `
  CREATE TABLE IF NOT EXISTS sprint_rollup (
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
    over_capacity_by INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )
`);
// <</phx:region>>

// <<phx:region iu=b9bb7ff20f5c774e1ce8b76f2bdf86a7e5705d8280ec49196276bad035f5d987 role=migration key=board>>
registerMigration('board', `
  CREATE TABLE IF NOT EXISTS board (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL DEFAULT 'Trail Board',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )
`);
// <</phx:region>>

// <<phx:region iu=b2da4c8aac573bd82405271a823883ab62b71c32184918bdfb101f637fcf2309 role=migration key=issues>>
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
    sprint_id INTEGER REFERENCES sprints(id),
    completed_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )
`);
// <</phx:region>>

// <<phx:region iu=71cccbcf51d41c225a0178f08d565f45ff1ba67766412db0f5fe682d56771d28 role=migration key=sprints>>
registerMigration('sprints', `
  CREATE TABLE IF NOT EXISTS sprints (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    goal TEXT,
    start_date TEXT NOT NULL,
    end_date TEXT NOT NULL,
    capacity INTEGER,
    is_closed INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )
`);
// <</phx:region>>

