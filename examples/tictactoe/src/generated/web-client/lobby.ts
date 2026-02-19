import { EventEmitter } from 'node:events';

export interface GameInfo {
  id: string;
  creatorName: string;
  playerCount: number;
  maxPlayers: number;
  status: 'waiting' | 'in-progress' | 'full';
}

export interface LobbyState {
  playerName: string;
  availableGames: GameInfo[];
  isConnected: boolean;
}

export interface LobbyEvents {
  gameCreated: (game: GameInfo) => void;
  gameUpdated: (game: GameInfo) => void;
  gameRemoved: (gameId: string) => void;
  playerNameChanged: (name: string) => void;
  connectionChanged: (connected: boolean) => void;
}

export class Lobby extends EventEmitter {
  private state: LobbyState = {
    playerName: '',
    availableGames: [],
    isConnected: false
  };

  constructor() {
    super();
  }

  public getState(): Readonly<LobbyState> {
    return { ...this.state };
  }

  public setPlayerName(name: string): void {
    const trimmedName = name.trim();
    if (trimmedName.length === 0) {
      throw new Error('Player name cannot be empty');
    }
    if (trimmedName.length > 50) {
      throw new Error('Player name cannot exceed 50 characters');
    }
    
    this.state.playerName = trimmedName;
    this.emit('playerNameChanged', trimmedName);
  }

  public canCreateGame(): boolean {
    return this.state.playerName.length > 0 && this.state.isConnected;
  }

  public canJoinGame(gameId: string): boolean {
    if (!this.state.playerName || !this.state.isConnected) {
      return false;
    }
    
    const game = this.state.availableGames.find(g => g.id === gameId);
    return game?.status === 'waiting' && game.playerCount < game.maxPlayers;
  }

  public createGame(): void {
    if (!this.canCreateGame()) {
      throw new Error('Cannot create game: player name required and must be connected');
    }
    
    const gameId = this.generateGameId();
    const newGame: GameInfo = {
      id: gameId,
      creatorName: this.state.playerName,
      playerCount: 1,
      maxPlayers: 2,
      status: 'waiting'
    };
    
    this.addGame(newGame);
    this.emit('gameCreated', newGame);
  }

  public joinGame(gameId: string): void {
    if (!this.canJoinGame(gameId)) {
      throw new Error('Cannot join game: requirements not met');
    }
    
    const game = this.state.availableGames.find(g => g.id === gameId);
    if (!game) {
      throw new Error('Game not found');
    }
    
    const updatedGame: GameInfo = {
      ...game,
      playerCount: game.playerCount + 1,
      status: game.playerCount + 1 >= game.maxPlayers ? 'full' : 'waiting'
    };
    
    this.updateGame(updatedGame);
    this.emit('gameUpdated', updatedGame);
  }

  public setConnectionStatus(connected: boolean): void {
    this.state.isConnected = connected;
    this.emit('connectionChanged', connected);
  }

  public addGame(game: GameInfo): void {
    const existingIndex = this.state.availableGames.findIndex(g => g.id === game.id);
    if (existingIndex >= 0) {
      this.state.availableGames[existingIndex] = game;
    } else {
      this.state.availableGames.push(game);
    }
  }

  public updateGame(game: GameInfo): void {
    const index = this.state.availableGames.findIndex(g => g.id === game.id);
    if (index >= 0) {
      this.state.availableGames[index] = game;
    }
  }

  public removeGame(gameId: string): void {
    this.state.availableGames = this.state.availableGames.filter(g => g.id !== gameId);
    this.emit('gameRemoved', gameId);
  }

  public renderHTML(): string {
    const nameInputDisabled = !this.state.isConnected ? 'disabled' : '';
    const createButtonDisabled = !this.canCreateGame() ? 'disabled' : '';
    
    const gamesHTML = this.state.availableGames
      .filter(game => game.status === 'waiting')
      .map(game => {
        const joinDisabled = !this.canJoinGame(game.id) ? 'disabled' : '';
        return `
          <div class="game-item" data-game-id="${game.id}">
            <div class="game-info">
              <span class="creator-name">${this.escapeHtml(game.creatorName)}</span>
              <span class="player-count">${game.playerCount}/${game.maxPlayers} players</span>
            </div>
            <button class="join-button" data-game-id="${game.id}" ${joinDisabled}>
              Join Game
            </button>
          </div>
        `;
      })
      .join('');

    return `
      <div class="lobby">
        <div class="lobby-header">
          <h1>Game Lobby</h1>
          <div class="connection-status ${this.state.isConnected ? 'connected' : 'disconnected'}">
            ${this.state.isConnected ? 'Connected' : 'Disconnected'}
          </div>
        </div>
        
        <div class="player-setup">
          <label for="player-name">Display Name:</label>
          <input 
            type="text" 
            id="player-name" 
            value="${this.escapeHtml(this.state.playerName)}" 
            placeholder="Enter your display name"
            maxlength="50"
            ${nameInputDisabled}
          />
          <button id="create-game" ${createButtonDisabled}>
            Create Game
          </button>
        </div>
        
        <div class="available-games">
          <h2>Available Games</h2>
          <div class="games-list">
            ${gamesHTML || '<div class="no-games">No games available</div>'}
          </div>
        </div>
      </div>
    `;
  }

  private generateGameId(): string {
    return Date.now().toString(36) + Math.random().toString(36).substring(2);
  }

  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
}

export function createLobby(): Lobby {
  return new Lobby();
}

/** @internal Phoenix VCS traceability — do not remove. */
export const _phoenix = {
  iu_id: '64213760b6aa34c15211b16e1e65ac318ccfce4fdea2ca50f9efd0738812036f',
  name: 'Lobby',
  risk_tier: 'medium',
  canon_ids: [5 as const],
} as const;