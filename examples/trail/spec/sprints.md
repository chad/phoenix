# Sprints

Sprints are time-boxed iterations that group issues for a planning period. A sprint gives the team a capacity target and a live rollup of how much work is planned, in flight, and finished.

## Sprints

- A sprint has a name, an optional goal statement, a start date, an end date, and a capacity expressed in points
- Every sprint must have a stable unique integer identifier
- Users can create a sprint by providing a name, a start date, and an end date
- Users can edit a sprint's name, goal, start date, end date, and capacity
- Users can close a sprint when the iteration is over; a closed sprint is read-only and its issues stay attached for the record
- Users can delete a sprint, but only if no issues are attached to it — issues must be moved to another sprint or back to the backlog first
- Users can view all sprints, with the active (not closed) sprints listed first and most recent start date first
- Exactly one sprint may be marked as the current sprint at a time; marking a new current sprint clears the previous one

## Sprint rollup

- For any sprint, the system must compute a live rollup: total issues, total points, completed points, points remaining, and the percentage of points completed
- The rollup must also break issues down by status, giving the count of issues in backlog, todo, in_progress, in_review, and done for that sprint
- The rollup must flag whether the sprint is over capacity — that is, whether total committed points exceed the sprint's capacity — and by how many points
- A sprint's completed points are the sum of estimates of its issues that are in the "done" status

## Validation rules

- A sprint name must not be empty and must not exceed 80 characters
- A goal, when set, must not exceed 280 characters
- The start date and end date must be valid dates and the end date must not be before the start date
- Capacity, when set, must be a positive whole number of points
- The system must expose sprint management and the rollup as a programmatic interface
