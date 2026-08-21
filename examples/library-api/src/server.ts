import { serve } from '@hono/node-server';
import { app, mount } from './app.js';
import { runMigrations } from './db.js';

// Shared aggregate artifacts (register migrations, etc.)
import './generated/_migrations.js';

// Generated route modules
import book from './generated/book/book.js';
import loan from './generated/loan/loan.js';
import member from './generated/member/member.js';
import summary from './generated/summary/summary.js';

// Mount routes
mount('/books', book);
mount('/loans', loan);
mount('/members', member);
mount('/summary', summary);

const port = parseInt(process.env.PORT ?? '3000', 10);
runMigrations();
console.log(`Server running at http://localhost:${port}`);
serve({ fetch: app.fetch, port });
