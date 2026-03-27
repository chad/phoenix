import { Hono } from 'hono';
import { db, registerMigration } from '../../db.js';
import { z } from 'zod';

// Register table migrations
registerMigration('categories', `
  CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    color TEXT NOT NULL DEFAULT '#3b82f6',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )
`);

registerMigration('todos', `
  CREATE TABLE IF NOT EXISTS todos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    completed INTEGER NOT NULL DEFAULT 0,
    category_id INTEGER REFERENCES categories(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )
`);

const router = new Hono();

// Validation schemas
const createTodoSchema = z.object({
  title: z.string().min(1),
  category_id: z.number().int().positive().optional()
});

const updateTodoSchema = z.object({
  title: z.string().min(1).optional(),
  completed: z.number().int().min(0).max(1).optional(),
  category_id: z.number().int().positive().optional().nullable()
});

const createCategorySchema = z.object({
  name: z.string().min(1),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/)
});

// Categories routes
router.get('/categories', (c) => {
  const stmt = db.prepare('SELECT * FROM categories ORDER BY name');
  const categories = stmt.all();
  return c.json(categories);
});

router.get('/categories/:id', (c) => {
  const id = parseInt(c.req.param('id'));
  if (isNaN(id)) {
    return c.json({ error: 'Invalid ID' }, 400);
  }
  
  const stmt = db.prepare('SELECT * FROM categories WHERE id = ?');
  const category = stmt.get(id);
  
  if (!category) {
    return c.json({ error: 'Not found' }, 404);
  }
  
  return c.json(category);
});

router.post('/categories', async (c) => {
  const body = await c.req.json();
  const result = createCategorySchema.safeParse(body);
  
  if (!result.success) {
    return c.json({ error: 'Invalid input' }, 400);
  }
  
  try {
    const stmt = db.prepare('INSERT INTO categories (name, color) VALUES (?, ?)');
    const info = stmt.run(result.data.name, result.data.color);
    
    const getStmt = db.prepare('SELECT * FROM categories WHERE id = ?');
    const category = getStmt.get(info.lastInsertRowid);
    
    return c.json(category, 201);
  } catch (error) {
    return c.json({ error: 'Category name already exists' }, 400);
  }
});

router.delete('/categories/:id', (c) => {
  const id = parseInt(c.req.param('id'));
  if (isNaN(id)) {
    return c.json({ error: 'Invalid ID' }, 400);
  }
  
  const stmt = db.prepare('DELETE FROM categories WHERE id = ?');
  const info = stmt.run(id);
  
  if (info.changes === 0) {
    return c.json({ error: 'Not found' }, 404);
  }
  
  return c.body(null, 204);
});

// Todos routes
router.get('/todos', (c) => {
  const stmt = db.prepare(`
    SELECT t.*, c.name as category_name, c.color as category_color
    FROM todos t
    LEFT JOIN categories c ON t.category_id = c.id
    ORDER BY t.created_at DESC
  `);
  const todos = stmt.all();
  return c.json(todos);
});

router.get('/todos/:id', (c) => {
  const id = parseInt(c.req.param('id'));
  if (isNaN(id)) {
    return c.json({ error: 'Invalid ID' }, 400);
  }
  
  const stmt = db.prepare(`
    SELECT t.*, c.name as category_name, c.color as category_color
    FROM todos t
    LEFT JOIN categories c ON t.category_id = c.id
    WHERE t.id = ?
  `);
  const todo = stmt.get(id);
  
  if (!todo) {
    return c.json({ error: 'Not found' }, 404);
  }
  
  return c.json(todo);
});

router.post('/todos', async (c) => {
  const body = await c.req.json();
  const result = createTodoSchema.safeParse(body);
  
  if (!result.success) {
    return c.json({ error: 'Invalid input' }, 400);
  }
  
  const stmt = db.prepare('INSERT INTO todos (title, category_id) VALUES (?, ?)');
  const info = stmt.run(result.data.title, result.data.category_id || null);
  
  const getStmt = db.prepare(`
    SELECT t.*, c.name as category_name, c.color as category_color
    FROM todos t
    LEFT JOIN categories c ON t.category_id = c.id
    WHERE t.id = ?
  `);
  const todo = getStmt.get(info.lastInsertRowid);
  
  return c.json(todo, 201);
});

router.patch('/todos/:id', async (c) => {
  const id = parseInt(c.req.param('id'));
  if (isNaN(id)) {
    return c.json({ error: 'Invalid ID' }, 400);
  }
  
  const body = await c.req.json();
  const result = updateTodoSchema.safeParse(body);
  
  if (!result.success) {
    return c.json({ error: 'Invalid input' }, 400);
  }
  
  const updates: string[] = [];
  const values: any[] = [];
  
  if (result.data.title !== undefined) {
    updates.push('title = ?');
    values.push(result.data.title);
  }
  
  if (result.data.completed !== undefined) {
    updates.push('completed = ?');
    values.push(result.data.completed);
  }
  
  if (result.data.category_id !== undefined) {
    updates.push('category_id = ?');
    values.push(result.data.category_id);
  }
  
  if (updates.length === 0) {
    return c.json({ error: 'No fields to update' }, 400);
  }
  
  values.push(id);
  const stmt = db.prepare(`UPDATE todos SET ${updates.join(', ')} WHERE id = ?`);
  const info = stmt.run(...values);
  
  if (info.changes === 0) {
    return c.json({ error: 'Not found' }, 404);
  }
  
  const getStmt = db.prepare(`
    SELECT t.*, c.name as category_name, c.color as category_color
    FROM todos t
    LEFT JOIN categories c ON t.category_id = c.id
    WHERE t.id = ?
  `);
  const todo = getStmt.get(id);
  
  return c.json(todo);
});

router.delete('/todos/:id', (c) => {
  const id = parseInt(c.req.param('id'));
  if (isNaN(id)) {
    return c.json({ error: 'Invalid ID' }, 400);
  }
  
  const stmt = db.prepare('DELETE FROM todos WHERE id = ?');
  const info = stmt.run(id);
  
  if (info.changes === 0) {
    return c.json({ error: 'Not found' }, 404);
  }
  
  return c.body(null, 204);
});

// Stats route
router.get('/stats', (c) => {
  const stmt = db.prepare(`
    SELECT 
      COUNT(*) as total_todos,
      SUM(completed) as completed_todos,
      COUNT(*) - SUM(completed) as incomplete_todos
    FROM todos
  `);
  const stats = stmt.get();
  return c.json(stats);
});

// Serve the web interface
router.get('/', (c) => {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Todos</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: system-ui, -apple-system, sans-serif;
            background-color: #f8fafc;
            color: #334155;
            line-height: 1.6;
        }
        
        .container {
            max-width: 640px;
            margin: 0 auto;
            padding: 2rem 1rem;
        }
        
        h1 {
            text-align: center;
            font-size: 2.5rem;
            font-weight: 700;
            color: #1e293b;
            margin-bottom: 2rem;
        }
        
        .stats {
            background: white;
            border-radius: 0.5rem;
            padding: 1.5rem;
            margin-bottom: 2rem;
            box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
            display: flex;
            justify-content: space-around;
            text-align: center;
        }
        
        .stat {
            display: flex;
            flex-direction: column;
        }
        
        .stat-number {
            font-size: 2rem;
            font-weight: 700;
            color: #3b82f6;
        }
        
        .stat-label {
            font-size: 0.875rem;
            color: #64748b;
            text-transform: uppercase;
            letter-spacing: 0.05em;
        }
        
        .section {
            background: white;
            border-radius: 0.5rem;
            padding: 1.5rem;
            margin-bottom: 2rem;
            box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
        }
        
        .section h2 {
            font-size: 1.25rem;
            font-weight: 600;
            margin-bottom: 1rem;
            color: #1e293b;
        }
        
        .form {
            display: flex;
            gap: 0.75rem;
            margin-bottom: 1rem;
            flex-wrap: wrap;
        }
        
        input, select, button {
            padding: 0.5rem 0.75rem;
            border: 1px solid #d1d5db;
            border-radius: 0.375rem;
            font-size: 0.875rem;
        }
        
        input[type="text"] {
            flex: 1;
            min-width: 200px;
        }
        
        input[type="color"] {
            width: 3rem;
            height: 2.5rem;
            padding: 0.25rem;
            cursor: pointer;
        }
        
        select {
            min-width: 120px;
        }
        
        button {
            background: #3b82f6;
            color: white;
            border: none;
            cursor: pointer;
            font-weight: 500;
            transition: background-color 0.2s;
        }
        
        button:hover {
            background: #2563eb;
        }
        
        button.danger {
            background: #ef4444;
        }
        
        button.danger:hover {
            background: #dc2626;
        }
        
        button.small {
            padding: 0.25rem 0.5rem;
            font-size: 0.75rem;
        }
        
        .filters {
            display: flex;
            gap: 0.5rem;
            margin-bottom: 1rem;
        }
        
        .filter-btn {
            background: #f1f5f9;
            color: #475569;
            border: 1px solid #e2e8f0;
            padding: 0.5rem 1rem;
            border-radius: 0.375rem;
            cursor: pointer;
            font-size: 0.875rem;
            transition: all 0.2s;
        }
        
        .filter-btn.active {
            background: #3b82f6;
            color: white;
            border-color: #3b82f6;
        }
        
        .todo-list {
            list-style: none;
        }
        
        .todo-item {
            display: flex;
            align-items: center;
            gap: 0.75rem;
            padding: 0.75rem;
            border: 1px solid #e2e8f0;
            border-radius: 0.375rem;
            margin-bottom: 0.5rem;
            background: #fefefe;
        }
        
        .todo-checkbox {
            width: 1.25rem;
            height: 1.25rem;
            cursor: pointer;
        }
        
        .todo-title {
            flex: 1;
            font-weight: 500;
        }
        
        .todo-title.completed {
            text-decoration: line-through;
            color: #64748b;
        }
        
        .category-badge {
            padding: 0.25rem 0.5rem;
            border-radius: 0.25rem;
            font-size: 0.75rem;
            font-weight: 500;
            color: white;
        }
        
        .category-list {
            list-style: none;
        }
        
        .category-item {
            display: flex;
            align-items: center;
            gap: 0.75rem;
            padding: 0.5rem;
            border: 1px solid #e2e8f0;
            border-radius: 0.375rem;
            margin-bottom: 0.5rem;
            background: #fefefe;
        }
        
        .category-color {
            width: 1rem;
            height: 1rem;
            border-radius: 50%;
        }
        
        .category-name {
            flex: 1;
            font-weight: 500;
        }
        
        .empty-state {
            text-align: center;
            color: #64748b;
            font-style: italic;
            padding: 2rem;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>todos</h1>
        
        <div class="stats">
            <div class="stat">
                <div class="stat-number" id="total-count">0</div>
                <div class="stat-label">Total</div>
            </div>
            <div class="stat">
                <div class="stat-number" id="completed-count">0</div>
                <div class="stat-label">Completed</div>
            </div>
            <div class="stat">
                <div class="stat-number" id="incomplete-count">0</div>
                <div class="stat-label">Incomplete</div>
            </div>
        </div>
        
        <div class="section">
            <h2>Add Todo</h2>
            <div class="form">
                <input type="text" id="todo-title" placeholder="Enter todo title..." />
                <select id="todo-category">
                    <option value="">No category</option>
                </select>
                <button onclick="createTodo()">Add Todo</button>
            </div>
        </div>
        
        <div class="section">
            <h2>Todos</h2>
            <div class="filters">
                <button class="filter-btn active" onclick="setFilter('all')">All</button>
                <button class="filter-btn" onclick="setFilter('active')">Active</button>
                <button class="filter-btn" onclick="setFilter('completed')">Completed</button>
            </div>
            <ul class="todo-list" id="todo-list">
                <li class="empty-state">Loading todos...</li>
            </ul>
        </div>
        
        <div class="section">
            <h2>Categories</h2>
            <div class="form">
                <input type="text" id="category-name" placeholder="Category name..." />
                <input type="color" id="category-color" value="#3b82f6" />
                <button onclick="createCategory()">Add Category</button>
            </div>
            <ul class="category-list" id="category-list">
                <li class="empty-state">Loading categories...</li>
            </ul>
        </div>
    </div>

    <script>
        let currentFilter = 'all';
        let todos = [];
        let categories = [];

        async function loadData() {
            await Promise.all([loadTodos(), loadCategories(), loadStats()]);
            renderTodos();
            renderCategories();
        }

        async function loadTodos() {
            const response = await fetch('/todos');
            todos = await response.json();
        }

        async function loadCategories() {
            const response = await fetch('/categories');
            categories = await response.json();
            renderCategorySelect();
        }

        async function loadStats() {
            const response = await fetch('/stats');
            const stats = await response.json();
            document.getElementById('total-count').textContent = stats.total_todos;
            document.getElementById('completed-count').textContent = stats.completed_todos;
            document.getElementById('incomplete-count').textContent = stats.incomplete_todos;
        }

        function renderCategorySelect() {
            const select = document.getElementById('todo-category');
            select.innerHTML = '<option value="">No category</option>';
            categories.forEach(cat => {
                const option = document.createElement('option');
                option.value = cat.id;
                option.textContent = cat.name;
                select.appendChild(option);
            });
        }

        function renderTodos() {
            const list = document.getElementById('todo-list');
            const filteredTodos = todos.filter(todo => {
                if (currentFilter === 'active') return !todo.completed;
                if (currentFilter === 'completed') return todo.completed;
                return true;
            });

            if (filteredTodos.length === 0) {
                list.innerHTML = '<li class="empty-state">No todos found</li>';
                return;
            }

            list.innerHTML = filteredTodos.map(todo => {
                const category = categories.find(c => c.id === todo.category_id);
                return \`
                    <li class="todo-item">
                        <input type="checkbox" class="todo-checkbox" 
                               \${todo.completed ? 'checked' : ''} 
                               onchange="toggleTodo(\${todo.id})" />
                        <span class="todo-title \${todo.completed ? 'completed' : ''}">\${todo.title}</span>
                        \${category ? \`<span class="category-badge" style="background-color: \${category.color}">\${category.name}</span>\` : ''}
                        <button class="danger small" onclick="deleteTodo(\${todo.id})">Delete</button>
                    </li>
                \`;
            }).join('');
        }

        function renderCategories() {
            const list = document.getElementById('category-list');
            
            if (categories.length === 0) {
                list.innerHTML = '<li class="empty-state">No categories found</li>';
                return;
            }

            list.innerHTML = categories.map(category => {
                const todoCount = todos.filter(t => t.category_id === category.id).length;
                return \`
                    <li class="category-item">
                        <div class="category-color" style="background-color: \${category.color}"></div>
                        <span class="category-name">\${category.name}</span>
                        \${todoCount === 0 ? \`<button class="danger small" onclick="deleteCategory(\${category.id})">Delete</button>\` : \`<span style="font-size: 0.75rem; color: #64748b;">(\${todoCount} todos)</span>\`}
                    </li>
                \`;
            }).join('');
        }

        function setFilter(filter) {
            currentFilter = filter;
            document.querySelectorAll('.filter-btn').forEach(btn => btn.classList.remove('active'));
            event.target.classList.add('active');
            renderTodos();
        }

        async function createTodo() {
            const title = document.getElementById('todo-title').value.trim();
            const categoryId = document.getElementById('todo-category').value;
            
            if (!title) return;

            const payload = { title };
            if (categoryId) payload.category_id = parseInt(categoryId);

            const response = await fetch('/todos', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (response.ok) {
                document.getElementById('todo-title').value = '';
                document.getElementById('todo-category').value = '';
                await loadData();
            }
        }

        async function toggleTodo(id) {
            const todo = todos.find(t => t.id === id);
            const response = await fetch(\`/todos/\${id}\`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ completed: todo.completed ? 0 : 1 })
            });

            if (response.ok) {
                await loadData();
            }
        }

        async function deleteTodo(id) {
            const response = await fetch(\`/todos/\${id}\`, { method: 'DELETE' });
            if (response.ok) {
                await loadData();
            }
        }

        async function createCategory() {
            const name = document.getElementById('category-name').value.trim();
            const color = document.getElementById('category-color').value;
            
            if (!name) return;

            const response = await fetch('/categories', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, color })
            });

            if (response.ok) {
                document.getElementById('category-name').value = '';
                document.getElementById('category-color').value = '#3b82f6';
                await loadData();
            }
        }

        async function deleteCategory(id) {
            const response = await fetch(\`/categories/\${id}\`, { method: 'DELETE' });
            if (response.ok) {
                await loadData();
            }
        }

        // Initialize the app
        loadData();
    </script>
</body>
</html>`;

  return c.html(html);
});

export default router;

/** @internal Phoenix VCS traceability — do not remove. */
export const _phoenix = {
  iu_id: '36212ecf5a73b3cdaf7f64d0fdfe77ac955188826af9854d63ab2168e88ab795',
  name: 'Web Interface',
  risk_tier: 'medium',
  canon_ids: [10 as const],
} as const;