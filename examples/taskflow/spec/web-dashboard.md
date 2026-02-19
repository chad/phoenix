# Task Dashboard Web Client

A single-page web dashboard for managing tasks. Served as HTML from the server.

## Dashboard Page

- The dashboard must render a complete HTML page with inline CSS and JavaScript
- The page must display a header with the title "TaskFlow" and a task count summary
- The page must include a form to create new tasks with fields: title, description, priority dropdown, and optional deadline date
- The create form must validate that title is non-empty before submission
- The page must use a clean, modern design with a blue (#2563eb) primary color

## Task List Display

- The dashboard must render all tasks as styled cards in a responsive grid layout
- Each task card must show: title, description, priority badge, status badge, assignee, and deadline
- Priority badges must be color-coded: critical=red, high=orange, medium=yellow, low=green
- Status badges must be color-coded: open=gray, in_progress=blue, review=purple, done=green
- Overdue tasks must have a red border and an "OVERDUE" indicator
- Each card must have buttons for status transitions (based on current status)

## Analytics Panel

- The dashboard must include a stats panel showing: total tasks, completed count, overdue count, and completion rate percentage
- The stats panel must render as a row of metric cards at the top of the page
- Each metric card must show the metric name, value, and an appropriate emoji icon

## Styles

- The dashboard must use CSS custom properties for theming (--primary, --danger, --success, --warning colors)
- The layout must be responsive: single column on mobile, multi-column grid on desktop
- Cards must have subtle shadows, rounded corners (8px), and hover effects
- The font must be system-ui with appropriate size hierarchy (h1: 1.5rem, body: 0.95rem)
- Buttons must have rounded corners, appropriate padding, and cursor pointer
