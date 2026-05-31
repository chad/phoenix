import { serve } from '@hono/node-server';
import { app, mount } from './app.js';
import { runMigrations } from './db.js';

// Shared aggregate artifacts (register migrations, etc.)
import './generated/_migrations.js';

// Generated route modules
import board from './generated/board/board.js';
import issue from './generated/issue/issue.js';
import sprint from './generated/sprint/sprint.js';
import sprint_rollup from './generated/sprint-rollup/sprint-rollup.js';

// Mount routes
mount('/board', board);
mount('/issue', issue);
mount('/sprint', sprint);
mount('/sprint-rollup', sprint_rollup);

const port = parseInt(process.env.PORT ?? '3000', 10);
runMigrations();
console.log(`Server running at http://localhost:${port}`);
serve({ fetch: app.fetch, port });
