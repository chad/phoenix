# Game Rules

Pixel Wars is a team-based territory capture game on a shared grid.

## Grid

- The grid is 15 columns × 15 rows 
- Each cell is either empty (null) or owned by a team color
- Initial grid state must be all empty cells
- Grid state must be stored in memory (no persistence needed)

## Teams

- There are exactly 4 teams: red, blue, green, and yellow
- A player's team is assigned round-robin on join to keep teams balanced
- A "team" is defined as all players sharing the same team color
- Team scores are the count of cells owned by that team's color

## Painting

- A player paints a cell by sending a message with {x, y} coordinates
- Painting must overwrite any existing cell color (stealing territory is allowed)
- Players must wait at least 500ms between paints (cooldown)
- Paints that violate the cooldown must be rejected with a "too_fast" error
- Out-of-bounds coordinates must be rejected with an "invalid_cell" error
- Every successful paint must be broadcast to all connected players immediately

## Scoring and Rounds

- A round lasts 110 seconds
- The server must broadcast the remaining time every second
- When the timer reaches zero, the team with the most cells wins
- After a round ends, the server must broadcast the final scores and winning team
- A new round must start automatically 10 seconds after the previous round ends
- The grid must be reset to all empty cells at the start of each new round
