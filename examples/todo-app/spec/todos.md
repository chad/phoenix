# Todoist-style Task Manager

A personal task manager for organizing work and life. Users manage tasks across projects with priorities, due dates, and completion tracking. The app should be usable from a web browser and integratable from other applications so tasks can surface in Slack, calendar apps, and other tools.

## Tasks

- A task has a title, an optional description, a priority (urgent, high, normal, low), an optional due date, and a completion status
- Every task must have a stable unique integer identifier that external systems can reference
- Users can create tasks by providing at least a title
- Users can view all their tasks, with the most urgent and overdue tasks shown first
- Users can mark a task as complete or reopen a completed task
- Users can edit a task's title, description, priority, or due date at any time
- Users can delete a task permanently
- Users can filter tasks by status: all, active (not completed), or completed
- Users can filter tasks by project
- Users can filter tasks by priority
- Filters must be combinable: for example, viewing all urgent tasks in a specific project
- Users must see a stats summary showing: total tasks, completed tasks, overdue tasks, and completion percentage; this summary must update immediately after any change
- Task titles must not be empty and must not exceed 500 characters
- Descriptions must not exceed 5000 characters
- Priority must always be one of: urgent, high, normal, low
- Due dates must be valid dates; the system must reject obviously invalid dates
- Due dates can be at any time, past, present or future. TODOs added in the past are automatically labeled as archived
- The system must expose these capabilities as a programmatic interface so external tools can create, read, update, and delete tasks using standard conventions

## Projects

- A project has a name and a color for visual identification
- Every project must have a stable unique integer identifier that external systems can reference
- Users can create projects to group related tasks
- Users can assign a task to a project, or leave it in a default "Inbox" with no project
- Users can delete a project only if it contains no tasks; the system must prevent deletion otherwise
- The project list must show how many active (incomplete) tasks each project has
- Deleting a project must never silently delete its tasks
- The system must expose project management as a programmatic interface

## Web Experience

- When users open the app in a browser, they see their task list immediately with no login required
- The main view shows a sidebar with projects (each with its color dot and active task count) and an "Inbox" option for unassigned tasks
- The main area shows the task list for the currently selected project or inbox, with the stats summary at the top
- Each task shows its title, priority as a colored badge (urgent=red, high=orange, normal=blue, low=gray), project name if assigned, due date if set, and a checkbox to toggle completion
- Completed tasks appear with a strikethrough title and dimmed appearance
- Overdue tasks have a red highlight or badge showing they are past due
- There is a prominent "Add task" form at the top of the task list with fields for title, description (collapsible), priority dropdown, project dropdown, and due date picker
- Filter buttons for All / Active / Completed appear above the task list, along with a priority filter dropdown
- Users can delete a task via a small delete button that appears on hover
- The design must be clean, modern, and responsive with a maximum content width of 800px, system-ui font, and a light neutral color scheme with colored accents for priorities and projects
- All interactions (create, complete, edit, delete, filter) must work without page reloads by calling the programmatic interface and updating the display
