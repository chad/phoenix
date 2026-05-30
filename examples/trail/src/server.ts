import { serve } from '@hono/node-server';
import { app, mount } from './app.js';
import { runMigrations } from './db.js';

// Generated route modules
import design from './generated/board/design.js';
import issues from './generated/issues/issues.js';
import validation_and_workflow_rules from './generated/issues/validation-and-workflow-rules.js';
import sprint_rollup from './generated/sprints/sprint-rollup.js';
import sprints from './generated/sprints/sprints.js';
import validation_rules from './generated/sprints/validation-rules.js';

// Mount routes
mount('/design', design);
mount('/issues', issues);
mount('/validation-and-workflow-rules', validation_and_workflow_rules);
mount('/sprint-rollup', sprint_rollup);
mount('/sprints', sprints);
mount('/validation-rules', validation_rules);

const port = parseInt(process.env.PORT ?? '3000', 10);
runMigrations();
console.log(`Server running at http://localhost:${port}`);
serve({ fetch: app.fetch, port });
