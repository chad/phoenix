import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';

export interface Player {
  readonly id: string;
  readonly displayName: string;
  readonly joinedAt: Date;
}

export interface PlayerJoinRequest {
  displayName: string;
}

export interface PlayerEvents {
  playerJoined: (player: Player) => void;
  playerLeft: (playerId: string) => void;
  displayNameChanged: (playerId: string, oldName: string, newName: string) => void;
}

export class PlayerManager extends EventEmitter {
  private players = new Map<string, Player>();
  private displayNames = new Set<string>();

  constructor() {
    super();
  }

  addPlayer(request: PlayerJoinRequest): Player {
    const trimmedName = request.displayName.trim();
    
    if (!trimmedName) {
      throw new Error('Display name cannot be empty');
    }

    if (trimmedName.length > 50) {
      throw new Error('Display name cannot exceed 50 characters');
    }

    if (this.displayNames.has(trimmedName.toLowerCase())) {
      throw new Error('Display name is already taken');
    }

    const player: Player = {
      id: randomUUID(),
      displayName: trimmedName,
      joinedAt: new Date()
    };

    this.players.set(player.id, player);
    this.displayNames.add(trimmedName.toLowerCase());

    this.emit('playerJoined', player);
    return player;
  }

  removePlayer(playerId: string): boolean {
    const player = this.players.get(playerId);
    if (!player) {
      return false;
    }

    this.players.delete(playerId);
    this.displayNames.delete(player.displayName.toLowerCase());

    this.emit('playerLeft', playerId);
    return true;
  }

  getPlayer(playerId: string): Player | undefined {
    return this.players.get(playerId);
  }

  getAllPlayers(): Player[] {
    return Array.from(this.players.values());
  }

  getPlayerCount(): number {
    return this.players.size;
  }

  isDisplayNameTaken(displayName: string): boolean {
    return this.displayNames.has(displayName.trim().toLowerCase());
  }

  updateDisplayName(playerId: string, newDisplayName: string): boolean {
    const player = this.players.get(playerId);
    if (!player) {
      throw new Error('Player not found');
    }

    const trimmedName = newDisplayName.trim();
    
    if (!trimmedName) {
      throw new Error('Display name cannot be empty');
    }

    if (trimmedName.length > 50) {
      throw new Error('Display name cannot exceed 50 characters');
    }

    if (trimmedName.toLowerCase() === player.displayName.toLowerCase()) {
      return false; // No change needed
    }

    if (this.displayNames.has(trimmedName.toLowerCase())) {
      throw new Error('Display name is already taken');
    }

    const oldName = player.displayName;
    this.displayNames.delete(oldName.toLowerCase());
    this.displayNames.add(trimmedName.toLowerCase());

    const updatedPlayer: Player = {
      ...player,
      displayName: trimmedName
    };

    this.players.set(playerId, updatedPlayer);
    this.emit('displayNameChanged', playerId, oldName, trimmedName);
    return true;
  }

  clear(): void {
    const playerIds = Array.from(this.players.keys());
    this.players.clear();
    this.displayNames.clear();

    for (const playerId of playerIds) {
      this.emit('playerLeft', playerId);
    }
  }
}

/** @internal Phoenix VCS traceability — do not remove. */
export const _phoenix = {
  iu_id: 'c616dc939f58968258c300b75aa9cbfb7c949faff800410e4e409d7ecd794207',
  name: 'Player Management',
  risk_tier: 'low',
  canon_ids: [3 as const],
} as const;