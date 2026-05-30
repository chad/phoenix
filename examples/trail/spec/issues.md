# Trail — Issue & Sprint Tracker

Trail is a lightweight issue tracker for small product teams, in the spirit of Linear or Jira but radically simpler. Work is captured as issues that move across a Kanban board, grouped into time-boxed sprints. The app is usable from a browser with no login, and exposes a programmatic interface so issues can be created and updated from other tools like CI systems and chat bots.

## Issues

- An issue has a title, an optional markdown description, a status, a priority, an optional point estimate, an optional assignee name, an optional set of labels, and an optional sprint it belongs to
- Every issue must have a stable unique integer identifier that external systems can reference
- Every issue records the time it was created and the time it was last updated
- Users can create an issue by providing at least a title; new issues start in the "backlog" status with "normal" priority
- Users can view all issues, ordered with the highest priority and most recently updated issues first
- Users can edit an issue's title, description, priority, estimate, assignee, labels, and sprint at any time
- Users can move an issue to a different status to reflect progress on the board
- Users can delete an issue permanently
- Users can filter issues by status, by assignee, by label, and by sprint, and these filters must be combinable
- Users can full-text search issues by words in their title or description
- When an issue first enters the "done" status, the system records a completion timestamp; if it later leaves "done", the completion timestamp is cleared

## Validation and workflow rules

- An issue title must not be empty and must not exceed 200 characters
- A description must not exceed 5000 characters
- Priority must always be one of: urgent, high, normal, low
- Status must always be one of: backlog, todo, in_progress, in_review, done
- A point estimate, when set, must be one of the planning-poker values: 1, 2, 3, 5, 8, 13
- Status changes must follow the board order — an issue may move one step forward (backlog → todo → in_progress → in_review → done) or one step backward; it may also be sent directly back to "backlog" from any status
- An issue may not be moved out of "backlog" unless it has a point estimate, because unestimated work cannot be scheduled
- A label is a short tag of at most 24 characters; an issue may have at most 8 labels and the same label must not appear twice on one issue
- The system must expose full issue management — create, read, update, delete, status change, and search — as a programmatic interface using standard conventions
