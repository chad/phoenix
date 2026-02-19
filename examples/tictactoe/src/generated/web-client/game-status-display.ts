export interface GameStatusNotification {
  type: 'turn' | 'result' | 'waiting' | 'connection';
  data: {
    isYourTurn?: boolean;
    playerName?: string;
    result?: 'win' | 'lose' | 'draw';
    isWaiting?: boolean;
    connectionStatus?: 'connected' | 'disconnected' | 'connecting';
  };
}

export interface GameStatusResult {
  html: string;
  className: string;
}

export class GameStatusDisplay {
  private currentStatus: GameStatusNotification | null = null;

  updateStatus(notification: GameStatusNotification): GameStatusResult {
    this.currentStatus = notification;
    return this.render();
  }

  private render(): GameStatusResult {
    if (!this.currentStatus) {
      return {
        html: '<div class="game-status">Ready to play</div>',
        className: 'status-ready'
      };
    }

    const { type, data } = this.currentStatus;

    switch (type) {
      case 'turn':
        return this.renderTurnStatus(data);
      case 'result':
        return this.renderGameResult(data);
      case 'waiting':
        return this.renderWaitingStatus();
      case 'connection':
        return this.renderConnectionStatus(data);
      default:
        return {
          html: '<div class="game-status">Unknown status</div>',
          className: 'status-unknown'
        };
    }
  }

  private renderTurnStatus(data: GameStatusNotification['data']): GameStatusResult {
    const isYourTurn = data.isYourTurn ?? false;
    const playerName = data.playerName || 'Player';
    
    if (isYourTurn) {
      return {
        html: '<div class="game-status turn-yours">Your turn</div>',
        className: 'status-your-turn'
      };
    } else {
      return {
        html: `<div class="game-status turn-opponent">${playerName}'s turn</div>`,
        className: 'status-opponent-turn'
      };
    }
  }

  private renderGameResult(data: GameStatusNotification['data']): GameStatusResult {
    const result = data.result;
    
    switch (result) {
      case 'win':
        return {
          html: '<div class="game-status result-win">🎉 You Win!</div>',
          className: 'status-win'
        };
      case 'lose':
        return {
          html: '<div class="game-status result-lose">😔 You Lose</div>',
          className: 'status-lose'
        };
      case 'draw':
        return {
          html: '<div class="game-status result-draw">🤝 Draw</div>',
          className: 'status-draw'
        };
      default:
        return {
          html: '<div class="game-status result-unknown">Game ended</div>',
          className: 'status-game-ended'
        };
    }
  }

  private renderWaitingStatus(): GameStatusResult {
    return {
      html: '<div class="game-status waiting">⏳ Waiting for opponent...</div>',
      className: 'status-waiting'
    };
  }

  private renderConnectionStatus(data: GameStatusNotification['data']): GameStatusResult {
    const status = data.connectionStatus || 'disconnected';
    
    switch (status) {
      case 'connected':
        return {
          html: '<div class="game-status connection-ok">🟢 Connected</div>',
          className: 'status-connected'
        };
      case 'connecting':
        return {
          html: '<div class="game-status connection-pending">🟡 Connecting...</div>',
          className: 'status-connecting'
        };
      case 'disconnected':
        return {
          html: '<div class="game-status connection-error">🔴 Disconnected</div>',
          className: 'status-disconnected'
        };
      default:
        return {
          html: '<div class="game-status connection-unknown">❓ Connection status unknown</div>',
          className: 'status-connection-unknown'
        };
    }
  }

  getCurrentStatus(): GameStatusNotification | null {
    return this.currentStatus;
  }

  reset(): void {
    this.currentStatus = null;
  }
}

export function createGameStatusDisplay(): GameStatusDisplay {
  return new GameStatusDisplay();
}

export function renderGameStatus(notification: GameStatusNotification): GameStatusResult {
  const display = new GameStatusDisplay();
  return display.updateStatus(notification);
}

/** @internal Phoenix VCS traceability — do not remove. */
export const _phoenix = {
  iu_id: '93a59f6c07719076dda9b8b06c6e2792461ca8d9769cef1e635d0409afcbecd2',
  name: 'Game Status Display',
  risk_tier: 'medium',
  canon_ids: [4 as const],
} as const;