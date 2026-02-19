export type Player = 'x' | 'o';

export type GameStatus = 'waiting' | 'in-progress' | 'x-wins' | 'o-wins' | 'draw';

export interface Move {
  player: Player;
  position: number;
  timestamp: Date;
}

export interface GameState {
  id: string;
  currentPlayer: Player;
  status: GameStatus;
  moves: Move[];
  createdAt: Date;
}

export class GameLifecycle {
  private games = new Map<string, GameState>();

  createGame(gameId: string): GameState {
    if (this.games.has(gameId)) {
      throw new Error(`Game with id ${gameId} already exists`);
    }

    const game: GameState = {
      id: gameId,
      currentPlayer: 'x',
      status: 'waiting',
      moves: [],
      createdAt: new Date(),
    };

    this.games.set(gameId, game);
    return { ...game };
  }

  getGame(gameId: string): GameState | null {
    const game = this.games.get(gameId);
    return game ? { ...game, moves: [...game.moves] } : null;
  }

  startGame(gameId: string): GameState {
    const game = this.games.get(gameId);
    if (!game) {
      throw new Error(`Game ${gameId} not found`);
    }

    if (game.status !== 'waiting') {
      throw new Error(`Game ${gameId} cannot be started from status: ${game.status}`);
    }

    game.status = 'in-progress';
    return { ...game, moves: [...game.moves] };
  }

  makeMove(gameId: string, position: number): GameState {
    const game = this.games.get(gameId);
    if (!game) {
      throw new Error(`Game ${gameId} not found`);
    }

    if (game.status !== 'in-progress') {
      throw new Error(`Cannot make move on game with status: ${game.status}`);
    }

    const move: Move = {
      player: game.currentPlayer,
      position,
      timestamp: new Date(),
    };

    game.moves.push(move);
    game.currentPlayer = game.currentPlayer === 'x' ? 'o' : 'x';

    return { ...game, moves: [...game.moves] };
  }

  setGameStatus(gameId: string, status: GameStatus): GameState {
    const game = this.games.get(gameId);
    if (!game) {
      throw new Error(`Game ${gameId} not found`);
    }

    const completedStatuses: GameStatus[] = ['x-wins', 'o-wins', 'draw'];
    if (completedStatuses.includes(game.status)) {
      throw new Error(`Cannot change status of completed game ${gameId}`);
    }

    game.status = status;
    return { ...game, moves: [...game.moves] };
  }

  getCurrentPlayer(gameId: string): Player | null {
    const game = this.games.get(gameId);
    return game ? game.currentPlayer : null;
  }

  getGameHistory(gameId: string): Move[] {
    const game = this.games.get(gameId);
    return game ? [...game.moves] : [];
  }

  isGameCompleted(gameId: string): boolean {
    const game = this.games.get(gameId);
    if (!game) return false;
    
    const completedStatuses: GameStatus[] = ['x-wins', 'o-wins', 'draw'];
    return completedStatuses.includes(game.status);
  }

  deleteGame(gameId: string): boolean {
    return this.games.delete(gameId);
  }

  getAllGames(): GameState[] {
    return Array.from(this.games.values()).map(game => ({
      ...game,
      moves: [...game.moves],
    }));
  }
}

export function createGameLifecycle(): GameLifecycle {
  return new GameLifecycle();
}

/** @internal Phoenix VCS traceability — do not remove. */
export const _phoenix = {
  iu_id: '7ebacd0c987e496ccede9d5bcfafb011fa84d264a6b9a68b354bf37c51be93b1',
  name: 'Game Lifecycle',
  risk_tier: 'high',
  canon_ids: [5 as const],
} as const;