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
  for (const d of ['src/generated', 'src/server.ts', 'src/app.ts', 'src/db.ts', '.phoenix', 'data']) {
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
  execSync(`node ${CLI} bootstrap`, { cwd: TODO_APP, stdio: 'pipe', timeout: 300000 });

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

console.log('\nRunning CRUD tests:');

// POST /todos — create
let createdId: number | null = null;
await test('POST /todos returns 201 with todo', async () => {
  const res = await fetch(`${BASE}/todos`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'Test todo' }),
  });
  if (res.status !== 201) return false;
  const body = await res.json() as Record<string, unknown>;
  createdId = body.id as number;
  return typeof body.id === 'number' && body.title === 'Test todo' && 'created_at' in body;
});

// POST /todos — validation
await test('POST /todos rejects empty title with 400', async () => {
  const res = await fetch(`${BASE}/todos`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: '' }),
  });
  if (res.status !== 400) return false;
  const body = await res.json() as Record<string, unknown>;
  return typeof body.error === 'string';
});

// GET /todos — list
await test('GET /todos returns array with created todo', async () => {
  const res = await fetch(`${BASE}/todos`);
  if (res.status !== 200) return false;
  const body = await res.json() as unknown[];
  return Array.isArray(body) && body.length >= 1;
});

// GET /todos/:id — get one
await test('GET /todos/:id returns the todo', async () => {
  if (!createdId) return false;
  const res = await fetch(`${BASE}/todos/${createdId}`);
  if (res.status !== 200) return false;
  const body = await res.json() as Record<string, unknown>;
  return body.title === 'Test todo';
});

// GET /todos/999 — 404
await test('GET /todos/999 returns 404', async () => {
  const res = await fetch(`${BASE}/todos/999`);
  return res.status === 404;
});

// PATCH /todos/:id — update
await test('PATCH /todos/:id updates completed', async () => {
  if (!createdId) return false;
  const res = await fetch(`${BASE}/todos/${createdId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ completed: 1 }),
  });
  if (res.status !== 200) return false;
  const body = await res.json() as Record<string, unknown>;
  return body.completed === 1;
});

// PATCH /todos/:id — update title
await test('PATCH /todos/:id updates title', async () => {
  if (!createdId) return false;
  const res = await fetch(`${BASE}/todos/${createdId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'Updated title' }),
  });
  if (res.status !== 200) return false;
  const body = await res.json() as Record<string, unknown>;
  return body.title === 'Updated title';
});

// Create another to delete
let deleteId: number | null = null;
await test('POST /todos creates second todo for deletion', async () => {
  const res = await fetch(`${BASE}/todos`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'Delete me' }),
  });
  if (res.status !== 201) return false;
  const body = await res.json() as Record<string, unknown>;
  deleteId = body.id as number;
  return true;
});

// DELETE /todos/:id
await test('DELETE /todos/:id returns 204', async () => {
  if (!deleteId) return false;
  const res = await fetch(`${BASE}/todos/${deleteId}`, { method: 'DELETE' });
  return res.status === 204;
});

// Verify deletion
await test('GET /todos/:id returns 404 after delete', async () => {
  if (!deleteId) return false;
  const res = await fetch(`${BASE}/todos/${deleteId}`);
  return res.status === 404;
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
