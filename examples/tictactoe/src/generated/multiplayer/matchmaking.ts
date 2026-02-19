import { EventEmitter } from 'node:events';

export interface GameSession {
  id: string;
  creatorId: string;
  joinerId?: string;
  status: 'waiting' | 'in-progress' | 'completed';
  createdAt: Date;
  startedAt?: Date;
}

export interface Player {
  id: string;
  symbol: 'x' | 'o';
}

export interface MatchmakingEvents {
  gameCreated: (session: GameSession) => void;
  playerJoined: (session: GameSession, joinerId: string) => void;
  gameStarted: (session: GameSession) => void;
  error: (error: Error) => void;
}

export class MatchmakingService extends EventEmitter {
  private sessions = new Map<string, GameSession>();
  private playerSessions = new Map<string, string>();

  constructor() {
    super();
  }

  createGame(playerId: string): GameSession {
    if (this.playerSessions.has(playerId)) {
      throw new Error('Player is already in a game session');
    }

    const gameId = this.generateGameId();
    const session: GameSession = {
      id: gameId,
      creatorId: playerId,
      status: 'waiting',
      createdAt: new Date(),
    };

    this.sessions.set(gameId, session);
    this.playerSessions.set(playerId, gameId);

    this.emit('gameCreated', session);
    return session;
  }

  joinGame(gameId: string, playerId: string): GameSession {
    if (this.playerSessions.has(playerId)) {
      throw new Error('Player is already in a game session');
    }

    const session = this.sessions.get(gameId);
    if (!session) {
      throw new Error('Game session not found');
    }

    if (session.status !== 'waiting') {
      throw new Error('Game is not available for joining');
    }

    if (session.creatorId === playerId) {
      throw new Error('Cannot join your own game');
    }

    if (session.joinerId) {
      throw new Error('Game is already full');
    }

    session.joinerId = playerId;
    session.status = 'in-progress';
    session.startedAt = new Date();

    this.playerSessions.set(playerId, gameId);

    this.emit('playerJoined', session, playerId);
    this.emit('gameStarted', session);

    return session;
  }

  getWaitingGames(): GameSession[] {
    return Array.from(this.sessions.values()).filter(
      session => session.status === 'waiting'
    );
  }

  getGameSession(gameId: string): GameSession | undefined {
    return this.sessions.get(gameId);
  }

  getPlayerSession(playerId: string): GameSession | undefined {
    const gameId = this.playerSessions.get(playerId);
    return gameId ? this.sessions.get(gameId) : undefined;
  }

  getPlayerRole(gameId: string, playerId: string): Player | null {
    const session = this.sessions.get(gameId);
    if (!session) {
      return null;
    }

    if (session.creatorId === playerId) {
      return { id: playerId, symbol: 'x' };
    }

    if (session.joinerId === playerId) {
      return { id: playerId, symbol: 'o' };
    }

    return null;
  }

  leaveGame(playerId: string): boolean {
    const gameId = this.playerSessions.get(playerId);
    if (!gameId) {
      return false;
    }

    const session = this.sessions.get(gameId);
    if (!session) {
      return false;
    }

    this.playerSessions.delete(playerId);

    if (session.creatorId === playerId) {
      // Creator left, remove the entire session
      if (session.joinerId) {
        this.playerSessions.delete(session.joinerId);
      }
      this.sessions.delete(gameId);
    } else if (session.joinerId === playerId) {
      // Joiner left, reset to waiting
      session.joinerId = undefined;
      session.status = 'waiting';
      session.startedAt = undefined;
    }

    return true;
  }

  completeGame(gameId: string): boolean {
    const session = this.sessions.get(gameId);
    if (!session || session.status !== 'in-progress') {
      return false;
    }

    session.status = 'completed';

    // Clean up player sessions
    this.playerSessions.delete(session.creatorId);
    if (session.joinerId) {
      this.playerSessions.delete(session.joinerId);
    }

    return true;
  }

  private generateGameId(): string {
    return Math.random().toString(36).substring(2, 15) + 
           Math.random().toString(36).substring(2, 15);
  }

  getSessionCount(): number {
    return this.sessions.size;
  }

  getActivePlayerCount(): number {
    return this.playerSessions.size;
  }
}

export function createMatchmakingService(): MatchmakingService {
  return new MatchmakingService();
}

/** @internal Phoenix VCS traceability — do not remove. */
export const _phoenix = {
  iu_id: 'd76ffd80fe3dc51ca9486800851150af95957393b39d14d714dd70299f502ea8',
  name: 'Matchmaking',
  risk_tier: 'high',
  canon_ids: [5 as const],
} as const;