# AUTO-GENERATED shared artifact: database migrations aggregated across IUs.
# Each region below is OWNED by exactly one Implementation Unit. Editing inside a
# region is drift attributed to that IU; Phoenix regenerates the whole file.
from src.db import register_migration

# <<phx:region iu=5df14a14fd32a2fa8c32571c305d78e16b30b82845662abd27db96cdaa3e1ddb role=migration key=issues>>
register_migration("issues", """
  CREATE TABLE IF NOT EXISTS issues (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'backlog',
    priority TEXT NOT NULL DEFAULT 'normal',
    point_estimate INTEGER,
    assignee TEXT,
    labels TEXT,
    sprint_id INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    completed_at TEXT,
    FOREIGN KEY (sprint_id) REFERENCES sprints (id)
  )
""")
# <</phx:region>>

# <<phx:region iu=71cccbcf51d41c225a0178f08d565f45ff1ba67766412db0f5fe682d56771d28 role=migration key=sprints>>
register_migration("sprints", """
  CREATE TABLE IF NOT EXISTS sprints (
    id INTEGER PRIMARY KEY AUTOINCREMENT,  
    name TEXT NOT NULL,
    goal TEXT DEFAULT '',
    start_date TEXT NOT NULL,
    end_date TEXT NOT NULL,
    capacity INTEGER,
    is_current INTEGER DEFAULT 0,
    is_closed INTEGER DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )
""")
# <</phx:region>>

