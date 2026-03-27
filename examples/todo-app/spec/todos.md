# Todo API

A REST API for managing todo lists and items, with categories and basic stats.

## Categories

- A category has: id (integer, auto-increment), name (text, required, unique), color (text, default '#888888')
- GET /categories must return all categories as a JSON array
- POST /categories must create a category and return it with 201
- DELETE /categories/:id must delete a category and return 204; if the category has todos, return 400 with an error
- Category name must not be empty and must be at most 50 characters

## Todos

- A todo has: id (integer, auto-increment), title (text, required), completed (integer 0 or 1, default 0), category_id (integer, nullable foreign key to categories), created_at (timestamp, default now)
- GET /todos must return all todos ordered by created_at descending, each todo must include its category name (as category_name) if it has one
- GET /todos?completed=1 must filter to only completed todos; GET /todos?completed=0 must filter to only incomplete todos
- GET /todos?category_id=N must filter to only todos in that category
- GET /todos/:id must return a single todo with category_name included, or 404
- POST /todos must create a todo with title and optional category_id, return 201
- PATCH /todos/:id must update title, completed, and/or category_id
- DELETE /todos/:id must delete a todo and return 204, or 404
- Title must not be empty and must be at most 200 characters
- If category_id is provided, it must reference an existing category; return 400 otherwise

## Stats

- GET /todos/stats must return a JSON object with: total (total todo count), completed (completed count), incomplete (incomplete count), by_category (array of {category_name, count} ordered by count descending)

## Web Interface

- GET / must serve a single-page HTML application with inline CSS and JavaScript
- The page must display a header with the title "Todos" and a stats summary showing total, completed, and incomplete counts
- The page must display a form to create new todos with a text input for title and a dropdown to select a category (populated from GET /categories)
- The page must display all todos as a list, each showing the title, category name as a colored badge, and a checkbox for completed status
- Clicking the checkbox must toggle the todo's completed status via PATCH /todos/:id
- Each todo must have a delete button that removes it via DELETE /todos/:id
- The page must display a category management section where users can add new categories with a name and color picker, and delete empty categories
- The page must include filter buttons: All, Active (incomplete), Completed
- The page must refresh the todo list and stats after every create, update, or delete action
- The design must be clean and modern with a centered layout, max-width 640px, system-ui font, subtle shadows, and a light color scheme

## Error Handling

- All error responses must be JSON with an "error" field
- Invalid JSON bodies must return 400
- Validation failures must return 400
