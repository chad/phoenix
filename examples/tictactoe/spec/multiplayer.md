# Multiplayer

## Player Management

- Each player must be identified by a unique player ID
- Players must choose a display name when joining
- A player can only be in one active game at a time
- The server must track all connected players

## Matchmaking

- A player must be able to create a new game and wait for an opponent
- A player must be able to join an existing game that is in "waiting" status
- The creator of a game always plays as Y
- The joiner always plays as O
- When a second player joins, the game status must change to "in-progress"

## Real-Time Communication

- The server must use WebSocket connections for real-time updates
- When a player makes a move, the opponent must be notified immediately
- When a player joins a game, both players must receive the updated game state
- When a game ends, both players must receive the final result
- If a player disconnects, the opponent must be notified within 5 seconds
- A disconnected player has 30 seconds to reconnect before forfeiting

## Game Rooms

- Each active game must have its own room that both players are subscribed to
- Spectators are not supported in v1
- Room messages must include: move, join, game-over, player-disconnected, player-reconnected
