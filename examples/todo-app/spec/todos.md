# Todo API

A REST API for managing todo items backed by SQLite.

## Todos Resource

- A todo has: id (integer, auto-increment primary key), title (text, required), completed (integer 0 or 1, default 0), and created_at (timestamp, set automatically on creation)
- GET / must return all todos as a JSON array ordered by created_at descending
- GET /:id must return a single todo as a JSON object, or 404 if not found
- POST / must create a new todo from a JSON request body containing a title field and return it with status 201
- PATCH /:id must update a todo's title and/or completed fields from a JSON request body, or 404 if not found
- DELETE /:id must delete a todo and return 204 with no body, or 404 if not found
- Title must not be empty
- Title must be at most 200 characters
- Completed must be 0 or 1
- All error responses must be JSON objects with an "error" field containing a human-readable message
- Invalid JSON request bodies must return 400
- Validation failures must return 400 with a description of what failed
