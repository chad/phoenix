import { serve } from '@hono/node-server';
import { app, mount } from './app.js';
import { runMigrations } from './db.js';

// Generated route modules
import design from './generated/board/design.js';
import issues from './generated/issues/issues.js';
import sprint_rollup from './generated/sprints/sprint-rollup.js';
import sprints from './generated/sprints/sprints.js';

// Mount routes
mount('/design', design);
mount('/issues', issues);
mount('/sprint-rollup', sprint_rollup);
mount('/sprints', sprints);

const port = parseInt(process.env.PORT ?? '3000', 10);
runMigrations();
console.log(`Server running at http://localhost:${port}`);
serve({ fetch: app.fetch, port });
