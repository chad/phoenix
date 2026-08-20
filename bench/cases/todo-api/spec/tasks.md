# Task API

A small task-tracking service that other tools drive over HTTP. It stores tasks and
reports a live summary of progress.

## Tasks

- A task has a title, a priority, a completed flag, and a creation timestamp
- Every task must have a stable unique integer identifier that external systems can reference
- Users can create a task by providing at least a title; priority defaults to normal and completed defaults to false
- A task title must not be empty and must not exceed 200 characters
- Priority must be one of: urgent, high, normal, low
- Users can list every task
- Users can read a single task by its identifier
- Users can update a task's title, priority, or completed flag
- Users can delete a task
- Reading, updating, or deleting a task that does not exist must be reported as not found
- Creating or updating a task with an empty title, an over-long title, or a priority outside the allowed set
  must be rejected, and must leave stored data unchanged

## Stats

- Users can read a summary of progress: the total number of tasks, the number completed, and the
  completion percentage rounded to a whole number
- A summary of no tasks reports a completion percentage of 0
- The summary must reflect every change immediately

## HTTP interface

The service exposes exactly these routes, and answers JSON on all of them:

- `GET /health` — returns 200 once the service is ready
- `POST /tasks` — creates a task from a JSON body; returns 201 and the created task
- `GET /tasks` — returns 200 and a JSON array of tasks
- `GET /tasks/:id` — returns 200 and the task, or 404 if there is no such task
- `PATCH /tasks/:id` — updates the given fields; returns 200 and the updated task, or 404
- `DELETE /tasks/:id` — returns 204 with no body, or 404
- `GET /stats` — returns 200 and `{ "total": n, "completed": n, "completion_percent": n }`

A rejected create or update returns 400.

In every response a task is a JSON object with the fields `id` (integer), `title` (string),
`priority` (string), `completed` (JSON `true`/`false`, never 0 or 1), and `created_at` (string).
