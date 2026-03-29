#!/usr/bin/env npx tsx
/**
 * Architecture Evaluation Runner — tests whether generated apps actually work.
 *
 * Workflow:
 * 1. Clean and re-bootstrap the todo-app example
 * 2. Start the server
 * 3. Run CRUD tests via HTTP
 * 4. Score: what percentage of operations work correctly
 * 5. Log results
 *
 * Usage: npx tsx experiments/eval-runner-arch.ts [--no-log]
 */

import { execSync, spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { appendFileSync, existsSync, rmSync } from 'node:fs';

const ROOT = resolve(import.meta.dirname, '..');
const TODO_APP = resolve(ROOT, 'examples/todo-app');
const RESULTS_FILE = resolve(ROOT, 'experiments/results-arch.tsv');
const CLI = resolve(ROOT, 'dist/cli.js');

const noLog = process.argv.includes('--no-log');
const skipBootstrap = process.argv.includes('--skip-bootstrap');

// ─── Step 1: Rebuild Phoenix and re-bootstrap todo-app ──────────────────────

if (!skipBootstrap) {
  console.log('Building Phoenix...');
  execSync('npm run build', { cwd: ROOT, stdio: 'pipe' });

  console.log('Cleaning todo-app...');
  for (const d of ['src', '.phoenix', 'data', 'dist']) {
    const p = resolve(TODO_APP, d);
    if (existsSync(p)) rmSync(p, { recursive: true, force: true });
  }
  // Remove db files
  for (const f of ['app.db', 'todos.db', 'data.db']) {
    const p = resolve(TODO_APP, f);
    if (existsSync(p)) rmSync(p);
  }

  console.log('Initializing with sqlite-web-api...');
  execSync(`node ${CLI} init --arch=sqlite-web-api`, { cwd: TODO_APP, stdio: 'pipe' });

  console.log('Bootstrapping (LLM generation)...');
  execSync(`node ${CLI} bootstrap`, { cwd: TODO_APP, stdio: 'pipe', timeout: 900000 });

  console.log('Installing dependencies...');
  execSync('npm install', { cwd: TODO_APP, stdio: 'pipe', timeout: 60000 });
}

// ─── Step 2: Start the server ───────────────────────────────────────────────

// Clean any leftover DB
const dbPath = resolve(TODO_APP, 'data/app.db');
if (existsSync(dbPath)) rmSync(dbPath);
const dbShm = dbPath + '-shm';
const dbWal = dbPath + '-wal';
if (existsSync(dbShm)) rmSync(dbShm);
if (existsSync(dbWal)) rmSync(dbWal);

console.log('Starting server...');
const server = spawn('npx', ['tsx', 'src/server.ts'], {
  cwd: TODO_APP,
  stdio: 'pipe',
  env: { ...process.env, PORT: '4567' },
});

let serverOutput = '';
server.stdout.on('data', (d) => { serverOutput += d.toString(); });
server.stderr.on('data', (d) => { serverOutput += d.toString(); });

// Wait for server to start
await new Promise<void>((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error('Server start timeout')), 10000);
  const check = setInterval(async () => {
    try {
      const res = await fetch('http://localhost:4567/health');
      if (res.ok) { clearInterval(check); clearTimeout(timeout); resolve(); }
    } catch { /* not ready yet */ }
  }, 500);
});

console.log('Server ready on :4567');

// ─── Step 3: Run CRUD tests ────────────────────────────────────────────────

interface TestResult {
  name: string;
  pass: boolean;
  detail: string;
}

const results: TestResult[] = [];
const BASE = 'http://localhost:4567';

async function test(name: string, fn: () => Promise<boolean>): Promise<void> {
  try {
    const pass = await fn();
    results.push({ name, pass, detail: pass ? 'ok' : 'assertion failed' });
    console.log(`  ${pass ? '✓' : '✗'} ${name}`);
  } catch (e) {
    results.push({ name, pass: false, detail: String(e) });
    console.log(`  ✗ ${name} — ${e}`);
  }
}

console.log('\nRunning tests:');

// ─── Categories ─────────────────────────────────────────────────────────────

let projId: number | null = null;

await test('POST /projects creates project', async () => {
  const res = await fetch(`${BASE}/projects`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Work', color: '#ff0000' }),
  });
  if (res.status !== 201) return false;
  const body = await res.json() as Record<string, unknown>;
  projId = body.id as number;
  return body.name === 'Work' && typeof body.id === 'number';
});

await test('POST /projects rejects empty name', async () => {
  const res = await fetch(`${BASE}/projects`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: '' }),
  });
  return res.status === 400;
});

await test('GET /projects returns array', async () => {
  const res = await fetch(`${BASE}/projects`);
  if (res.status !== 200) return false;
  const body = await res.json() as unknown[];
  return Array.isArray(body) && body.length >= 1;
});

// ─── Todos with categories ──────────────────────────────────────────────────

let todoId: number | null = null;

await test('POST /todos creates todo with category', async () => {
  const res = await fetch(`${BASE}/tasks`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'Finish report', project_id: projId }),
  });
  if (res.status !== 201) return false;
  const body = await res.json() as Record<string, unknown>;
  todoId = body.id as number;
  return body.title === 'Finish report' && typeof body.id === 'number';
});

await test('POST /todos creates todo without category', async () => {
  const res = await fetch(`${BASE}/tasks`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'Buy milk' }),
  });
  return res.status === 201;
});

await test('POST /todos rejects invalid project_id', async () => {
  const res = await fetch(`${BASE}/tasks`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'Bad category', project_id: 9999 }),
  });
  return res.status === 400;
});

await test('POST /todos rejects empty title', async () => {
  const res = await fetch(`${BASE}/tasks`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: '' }),
  });
  return res.status === 400;
});

await test('GET /todos returns todos with project_name', async () => {
  const res = await fetch(`${BASE}/tasks`);
  if (res.status !== 200) return false;
  const body = await res.json() as Array<Record<string, unknown>>;
  const withCat = body.find(t => t.title === 'Finish report');
  return withCat?.project_name === 'Work';
});

await test('GET /todos/:id returns todo with project_name', async () => {
  if (!todoId) return false;
  const res = await fetch(`${BASE}/tasks/${todoId}`);
  if (res.status !== 200) return false;
  const body = await res.json() as Record<string, unknown>;
  return body.project_name === 'Work';
});

await test('GET /todos/999 returns 404', async () => {
  return (await fetch(`${BASE}/tasks/999`)).status === 404;
});

// ─── Filtering ──────────────────────────────────────────────────────────────

await test('PATCH /todos/:id marks completed', async () => {
  if (!todoId) return false;
  // Try integer 1, then boolean true — LLM might use either schema
  let res = await fetch(`${BASE}/tasks/${todoId}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ completed: 1 }),
  });
  if (res.status !== 200) {
    res = await fetch(`${BASE}/tasks/${todoId}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ completed: true }),
    });
  }
  if (res.status !== 200) return false;
  const body = await res.json() as Record<string, unknown>;
  return body.completed === 1 || body.completed === true;
});

await test('GET /todos?completed=1 filters completed', async () => {
  let res = await fetch(`${BASE}/tasks?completed=1`);
  if (res.status !== 200) res = await fetch(`${BASE}/tasks?completed=true`);
  if (res.status !== 200) return false;
  const body = await res.json() as Array<Record<string, unknown>>;
  return body.length >= 1 && body.every(t => t.completed === 1 || t.completed === true);
});

await test('GET /todos?completed=0 filters incomplete', async () => {
  // Try both completed=0 and status=active since LLM may interpret either way
  let res = await fetch(`${BASE}/tasks?completed=0`);
  if (res.status !== 200) res = await fetch(`${BASE}/tasks?completed=false`);
  if (res.status !== 200) return false;
  const body = await res.json() as Array<Record<string, unknown>>;
  return body.length >= 1 && body.every(t => t.completed === 0 || t.completed === false);
});

await test('GET /todos?project_id=N filters by category', async () => {
  if (!projId) return false;
  const res = await fetch(`${BASE}/tasks?project_id=${projId}`);
  if (res.status !== 200) return false;
  const body = await res.json() as Array<Record<string, unknown>>;
  return body.length >= 1;
});

// ─── Stats ──────────────────────────────────────────────────────────────────

await test('GET /stats returns counts', async () => {
  const res = await fetch(`${BASE}/tasks/stats`);
  if (res.status !== 200) return false;
  const body = await res.json() as Record<string, unknown>;
  // Accept various field naming conventions
  const hasTotal = typeof body.total === 'number' || typeof body.total_tasks === 'number';
  const hasCompleted = typeof body.completed === 'number' || typeof body.completed_tasks === 'number';
  return hasTotal && hasCompleted;
});

await test('GET /stats includes aggregates', async () => {
  const res = await fetch(`${BASE}/tasks/stats`);
  if (res.status !== 200) return false;
  const body = await res.json() as Record<string, unknown>;
  // Accept by_category, by_project, or any array field with counts
  const hasAggregates = body.by_category || body.by_project || body.overdue_tasks !== undefined || body.completion_percentage !== undefined;
  return !!hasAggregates;
});

// ─── Delete ─────────────────────────────────────────────────────────────────

await test('DELETE /todos/:id returns 204', async () => {
  if (!todoId) return false;
  return (await fetch(`${BASE}/tasks/${todoId}`, { method: 'DELETE' })).status === 204;
});

await test('DELETE /projects/:id with todos returns 400', async () => {
  // "Buy milk" has no category, but create one with a category to test
  const res = await fetch(`${BASE}/projects`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Temp' }),
  });
  const cat = await res.json() as Record<string, unknown>;
  await fetch(`${BASE}/tasks`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'Temp todo', project_id: cat.id }),
  });
  const delRes = await fetch(`${BASE}/projects/${cat.id}`, { method: 'DELETE' });
  return delRes.status === 400;
});

await test('DELETE /projects/:id without todos returns 204', async () => {
  if (!projId) return false;
  // projId's todos were already deleted
  return (await fetch(`${BASE}/projects/${projId}`, { method: 'DELETE' })).status === 204;
});

// ─── Step 4: Score ──────────────────────────────────────────────────────────

server.kill();

const passed = results.filter(r => r.pass).length;
const total = results.length;
const score = total > 0 ? passed / total : 0;

console.log(`\n  Score: ${passed}/${total} (${(score * 100).toFixed(0)}%)`);
for (const r of results.filter(r => !r.pass)) {
  console.log(`    FAIL: ${r.name} — ${r.detail}`);
}

// ─── Step 5: Log ────────────────────────────────────────────────────────────

if (!noLog) {
  const header = 'timestamp\tscore\tpassed\ttotal\tfailures';
  if (!existsSync(RESULTS_FILE)) {
    appendFileSync(RESULTS_FILE, header + '\n');
  }
  const failures = results.filter(r => !r.pass).map(r => r.name).join('; ') || 'none';
  const row = [new Date().toISOString(), score.toFixed(2), passed, total, failures].join('\t');
  appendFileSync(RESULTS_FILE, row + '\n');
  console.log(`  Results appended to experiments/results-arch.tsv`);
}

console.log(`\nval_score=${score.toFixed(4)}`);
process.exit(score === 1 ? 0 : 1);
