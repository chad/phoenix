# Board — Web Experience

The board is the home screen of Trail. When users open the app in a browser they see the Kanban board immediately, with no login required, calling the programmatic interface and updating the display without page reloads.

## Layout

- The screen has a top bar with the Trail name, a sprint selector, and a live stats summary for the selected view
- Below the top bar is the Kanban board: five columns in board order — Backlog, Todo, In Progress, In Review, Done — each showing its issues as cards
- Each column shows its name, the number of issues in it, and the sum of points in it
- The columns use distinct accent colors so the stages are visually separable at a glance: backlog gray, todo blue, in progress amber, in review purple, done green

## Issue cards

- Each card shows the issue title, a colored priority badge (urgent red, high orange, normal blue, low gray), the point estimate if set, the assignee if set, and any labels as small chips
- A card in the Done column shows a subtle completed treatment such as a check mark and dimmed appearance
- Clicking a card opens a detail panel where the user can edit every field of the issue, change its status, and delete it
- Each card has quick controls to move it one step forward or one step backward in the workflow without opening the detail panel

## Controls

- The sprint selector lets the user switch between the current sprint, any other sprint, and a "Backlog" view that shows issues not attached to any sprint
- The stats summary shows, for the selected sprint or view: total issues, total points, completed points, percent complete shown as a progress bar, and a clear warning when the sprint is over capacity
- A prominent "New issue" form lets the user add an issue with a title, description, priority, estimate, assignee, labels, and target column
- A filter row lets the user filter the board by assignee and by label, and a search box filters cards by text in the title or description; filters and search apply across all columns at once

## Design

- The design must be clean, modern, and responsive, using a system-ui font and a light neutral background with the column accent colors for emphasis
- The board must remain usable on a laptop screen with all five columns visible side by side and horizontally scrollable on narrow screens
- All interactions — create, edit, move, delete, filter, search, switch sprint — must work without full page reloads by calling the programmatic interface and updating the display in place
