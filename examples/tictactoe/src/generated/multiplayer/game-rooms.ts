import { EventEmitter } from 'node:events';

export interface GameRoom {
  id: string;
  gameId: string;
  players: Set<string>;
  createdAt: Date;
  lastActivity: Date;
}

export interface RoomMessage {
  type: 'move' | 'join' | 'game-over' | 'player-disconnected' | 'player-reconnected';
  roomId: string;
  playerId: string;
  timestamp: Date;
  data?: any;
}

export interface MoveMessage extends RoomMessage {
  type: 'move';
  data: {
    move: string;
    gameState?: any;
  };
}

export interface JoinMessage extends RoomMessage {
  type: 'join';
  data: {
    playerName: string;
    playerCount: number;
  };
}

export interface GameOverMessage extends RoomMessage {
  type: 'game-over';
  data: {
    winner?: string;
    reason: string;
    finalState?: any;
  };
}

export interface PlayerDisconnectedMessage extends RoomMessage {
  type: 'player-disconnected';
  data: {
    playerName: string;
    remainingPlayers: number;
  };
}

export interface PlayerReconnectedMessage extends RoomMessage {
  type: 'player-reconnected';
  data: {
    playerName: string;
    currentPlayers: number;
  };
}

export type TypedRoomMessage = MoveMessage | JoinMessage | GameOverMessage | PlayerDisconnectedMessage | PlayerReconnectedMessage;

export class GameRoomManager extends EventEmitter {
  private rooms = new Map<string, GameRoom>();
  private playerRoomMap = new Map<string, string>();

  createRoom(gameId: string): GameRoom {
    const roomId = `room_${gameId}_${Date.now()}`;
    const room: GameRoom = {
      id: roomId,
      gameId,
      players: new Set(),
      createdAt: new Date(),
      lastActivity: new Date()
    };

    this.rooms.set(roomId, room);
    this.emit('room-created', room);
    return room;
  }

  joinRoom(roomId: string, playerId: string, playerName: string): boolean {
    const room = this.rooms.get(roomId);
    if (!room) {
      return false;
    }

    // Remove player from any existing room
    this.leaveCurrentRoom(playerId);

    room.players.add(playerId);
    room.lastActivity = new Date();
    this.playerRoomMap.set(playerId, roomId);

    const message: JoinMessage = {
      type: 'join',
      roomId,
      playerId,
      timestamp: new Date(),
      data: {
        playerName,
        playerCount: room.players.size
      }
    };

    this.broadcastToRoom(roomId, message);
    return true;
  }

  leaveRoom(roomId: string, playerId: string): boolean {
    const room = this.rooms.get(roomId);
    if (!room || !room.players.has(playerId)) {
      return false;
    }

    room.players.delete(playerId);
    room.lastActivity = new Date();
    this.playerRoomMap.delete(playerId);

    // Clean up empty rooms
    if (room.players.size === 0) {
      this.rooms.delete(roomId);
      this.emit('room-destroyed', room);
    }

    return true;
  }

  sendMove(roomId: string, playerId: string, move: string, gameState?: any): boolean {
    const room = this.rooms.get(roomId);
    if (!room || !room.players.has(playerId)) {
      return false;
    }

    room.lastActivity = new Date();

    const message: MoveMessage = {
      type: 'move',
      roomId,
      playerId,
      timestamp: new Date(),
      data: {
        move,
        gameState
      }
    };

    this.broadcastToRoom(roomId, message);
    return true;
  }

  endGame(roomId: string, winner?: string, reason: string = 'game completed', finalState?: any): boolean {
    const room = this.rooms.get(roomId);
    if (!room) {
      return false;
    }

    room.lastActivity = new Date();

    const message: GameOverMessage = {
      type: 'game-over',
      roomId,
      playerId: winner || '',
      timestamp: new Date(),
      data: {
        winner,
        reason,
        finalState
      }
    };

    this.broadcastToRoom(roomId, message);
    return true;
  }

  handlePlayerDisconnection(playerId: string, playerName: string): void {
    const roomId = this.playerRoomMap.get(playerId);
    if (!roomId) {
      return;
    }

    const room = this.rooms.get(roomId);
    if (!room) {
      return;
    }

    room.lastActivity = new Date();

    const message: PlayerDisconnectedMessage = {
      type: 'player-disconnected',
      roomId,
      playerId,
      timestamp: new Date(),
      data: {
        playerName,
        remainingPlayers: room.players.size - 1
      }
    };

    this.broadcastToRoom(roomId, message);
  }

  handlePlayerReconnection(playerId: string, playerName: string): void {
    const roomId = this.playerRoomMap.get(playerId);
    if (!roomId) {
      return;
    }

    const room = this.rooms.get(roomId);
    if (!room) {
      return;
    }

    room.lastActivity = new Date();

    const message: PlayerReconnectedMessage = {
      type: 'player-reconnected',
      roomId,
      playerId,
      timestamp: new Date(),
      data: {
        playerName,
        currentPlayers: room.players.size
      }
    };

    this.broadcastToRoom(roomId, message);
  }

  getRoom(roomId: string): GameRoom | undefined {
    return this.rooms.get(roomId);
  }

  getPlayerRoom(playerId: string): GameRoom | undefined {
    const roomId = this.playerRoomMap.get(playerId);
    return roomId ? this.rooms.get(roomId) : undefined;
  }

  getRoomsByGame(gameId: string): GameRoom[] {
    return Array.from(this.rooms.values()).filter(room => room.gameId === gameId);
  }

  getAllRooms(): GameRoom[] {
    return Array.from(this.rooms.values());
  }

  private leaveCurrentRoom(playerId: string): void {
    const currentRoomId = this.playerRoomMap.get(playerId);
    if (currentRoomId) {
      this.leaveRoom(currentRoomId, playerId);
    }
  }

  private broadcastToRoom(roomId: string, message: TypedRoomMessage): void {
    const room = this.rooms.get(roomId);
    if (!room) {
      return;
    }

    // Emit to all players in the room
    for (const playerId of room.players) {
      this.emit('message', playerId, message);
    }

    // Also emit a general room message event
    this.emit('room-message', roomId, message);
  }

  cleanupInactiveRooms(maxInactiveMinutes: number = 30): number {
    const cutoffTime = new Date(Date.now() - maxInactiveMinutes * 60 * 1000);
    let cleanedCount = 0;

    for (const [roomId, room] of this.rooms.entries()) {
      if (room.lastActivity < cutoffTime) {
        // Remove all players from the room
        for (const playerId of room.players) {
          this.playerRoomMap.delete(playerId);
        }
        
        this.rooms.delete(roomId);
        this.emit('room-destroyed', room);
        cleanedCount++;
      }
    }

    return cleanedCount;
  }
}

export function createGameRoomManager(): GameRoomManager {
  return new GameRoomManager();
}

/** @internal Phoenix VCS traceability — do not remove. */
export const _phoenix = {
  iu_id: '5095bcec288e546dc75c443ad5837b0a0cd8770db1e2eb331d1d0ffc4eb4e00f',
  name: 'Game Rooms',
  risk_tier: 'low',
  canon_ids: [2 as const],
} as const;