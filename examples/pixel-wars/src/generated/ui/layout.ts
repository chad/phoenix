export interface Player {
  id: string;
  name: string;
  score: number;
  isCurrentPlayer?: boolean;
}

export interface LayoutConfig {
  gridSize: number;
  showScoreboard: boolean;
  currentPlayerId?: string;
}

export interface LayoutState {
  players: Player[];
  gridContent: string;
  config: LayoutConfig;
}

export class Layout {
  private state: LayoutState;

  constructor(config: LayoutConfig) {
    this.state = {
      players: [],
      gridContent: '',
      config,
    };
  }

  public setPlayers(players: Player[]): void {
    this.state.players = players.map(player => ({
      ...player,
      isCurrentPlayer: player.id === this.state.config.currentPlayerId,
    }));
  }

  public setGridContent(content: string): void {
    this.state.gridContent = content;
  }

  public setCurrentPlayer(playerId: string): void {
    this.state.config.currentPlayerId = playerId;
    this.setPlayers(this.state.players);
  }

  public render(): string {
    const scoreboard = this.renderScoreboard();
    const grid = this.renderGrid();

    return `
      <div class="layout-container" style="${this.getContainerStyles()}">
        ${this.state.config.showScoreboard ? scoreboard : ''}
        <div class="grid-container" style="${this.getGridContainerStyles()}">
          ${grid}
        </div>
      </div>
    `;
  }

  private renderScoreboard(): string {
    if (!this.state.players.length) {
      return '<div class="scoreboard" style="display: none;"></div>';
    }

    const playerItems = this.state.players
      .map(player => this.renderPlayerItem(player))
      .join('');

    return `
      <div class="scoreboard" style="${this.getScoreboardStyles()}">
        <h3 style="${this.getScoreboardTitleStyles()}">Scoreboard</h3>
        <div class="player-list">
          ${playerItems}
        </div>
      </div>
    `;
  }

  private renderPlayerItem(player: Player): string {
    const isHighlighted = player.isCurrentPlayer ?? false;
    const itemStyles = this.getPlayerItemStyles(isHighlighted);

    return `
      <div class="player-item" style="${itemStyles}">
        <span class="player-name">${this.escapeHtml(player.name)}</span>
        <span class="player-score">${player.score}</span>
      </div>
    `;
  }

  private renderGrid(): string {
    return `
      <div class="game-grid" style="${this.getGridStyles()}">
        ${this.state.gridContent}
      </div>
    `;
  }

  private getContainerStyles(): string {
    return [
      'background-color: #1a1a2e',
      'min-height: 100vh',
      'display: flex',
      'flex-direction: column',
      'align-items: center',
      'justify-content: center',
      'padding: 20px',
      'box-sizing: border-box',
      'font-family: Arial, sans-serif',
    ].join('; ');
  }

  private getGridContainerStyles(): string {
    return [
      'display: flex',
      'justify-content: center',
      'align-items: center',
      'flex: 1',
    ].join('; ');
  }

  private getGridStyles(): string {
    return [
      'background-color: rgba(255, 255, 255, 0.1)',
      'border-radius: 8px',
      'padding: 20px',
      'box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3)',
    ].join('; ');
  }

  private getScoreboardStyles(): string {
    return [
      'background-color: rgba(255, 255, 255, 0.05)',
      'border-radius: 8px',
      'padding: 16px',
      'margin-bottom: 20px',
      'min-width: 200px',
      'border: 1px solid rgba(255, 255, 255, 0.1)',
    ].join('; ');
  }

  private getScoreboardTitleStyles(): string {
    return [
      'color: #ffffff',
      'margin: 0 0 12px 0',
      'font-size: 18px',
      'font-weight: bold',
      'text-align: center',
    ].join('; ');
  }

  private getPlayerItemStyles(isHighlighted: boolean): string {
    const baseStyles = [
      'display: flex',
      'justify-content: space-between',
      'align-items: center',
      'padding: 8px 12px',
      'margin: 4px 0',
      'border-radius: 4px',
      'transition: all 0.2s ease',
    ];

    if (isHighlighted) {
      baseStyles.push(
        'background-color: rgba(74, 144, 226, 0.3)',
        'border: 2px solid #4a90e2',
        'color: #ffffff',
        'font-weight: bold'
      );
    } else {
      baseStyles.push(
        'background-color: rgba(255, 255, 255, 0.05)',
        'border: 1px solid rgba(255, 255, 255, 0.1)',
        'color: #cccccc'
      );
    }

    return baseStyles.join('; ');
  }

  private escapeHtml(text: string): string {
    const div = { innerHTML: '' } as { innerHTML: string };
    const textNode = text;
    return textNode
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  public getState(): Readonly<LayoutState> {
    return { ...this.state };
  }

  public updateConfig(updates: Partial<LayoutConfig>): void {
    this.state.config = { ...this.state.config, ...updates };
    if (updates.currentPlayerId !== undefined) {
      this.setPlayers(this.state.players);
    }
  }
}

export function createLayout(config: LayoutConfig): Layout {
  return new Layout(config);
}

export function renderStaticLayout(gridContent: string, players: Player[] = [], currentPlayerId?: string): string {
  const layout = createLayout({
    gridSize: 3,
    showScoreboard: players.length > 0,
    currentPlayerId,
  });

  layout.setPlayers(players);
  layout.setGridContent(gridContent);

  return layout.render();
}

/** @internal Phoenix VCS traceability — do not remove. */
export const _phoenix = {
  iu_id: '9a35a9f5ebc71f65e83ff408274437068be7102b862e2935ac1476754d238566',
  name: 'Layout',
  risk_tier: 'low',
  canon_ids: [2 as const],
} as const;