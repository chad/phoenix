export interface StyleConfig {
  boardSize: number;
  cellSize: number;
  gap: number;
  borderRadius: number;
  fontSize: number;
  lineWidth: number;
}

export interface ResponsiveBreakpoints {
  mobile: number;
  tablet: number;
  desktop: number;
}

export class StylingManager {
  private readonly breakpoints: ResponsiveBreakpoints = {
    mobile: 768,
    tablet: 1024,
    desktop: 1200
  };

  private currentConfig: StyleConfig;

  constructor() {
    this.currentConfig = this.calculateResponsiveConfig();
    this.setupResponsiveListener();
  }

  private calculateResponsiveConfig(): StyleConfig {
    const screenWidth = 1024;
    const screenHeight = 768;
    const minDimension = Math.min(screenWidth, screenHeight);

    if (screenWidth <= this.breakpoints.mobile) {
      return {
        boardSize: Math.min(minDimension * 0.85, 300),
        cellSize: Math.min(minDimension * 0.25, 90),
        gap: 4,
        borderRadius: 8,
        fontSize: 48,
        lineWidth: 4
      };
    } else if (screenWidth <= this.breakpoints.tablet) {
      return {
        boardSize: Math.min(minDimension * 0.7, 400),
        cellSize: Math.min(minDimension * 0.2, 120),
        gap: 6,
        borderRadius: 12,
        fontSize: 64,
        lineWidth: 5
      };
    } else {
      return {
        boardSize: Math.min(minDimension * 0.6, 480),
        cellSize: Math.min(minDimension * 0.15, 150),
        gap: 8,
        borderRadius: 16,
        fontSize: 80,
        lineWidth: 6
      };
    }
  }

  private setupResponsiveListener(): void {
    // No-op for server-side rendering
  }

  public generateCSS(): string {
    const config = this.currentConfig;
    
    return `
      * {
        box-sizing: border-box;
        margin: 0;
        padding: 0;
      }

      body {
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        background: linear-gradient(135deg, #f5f7fa 0%, #c3cfe2 100%);
        min-height: 100vh;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 20px;
      }

      .game-container {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 30px;
        max-width: 100%;
      }

      .game-board {
        display: grid;
        grid-template-columns: repeat(3, ${config.cellSize}px);
        grid-template-rows: repeat(3, ${config.cellSize}px);
        gap: ${config.gap}px;
        background: #ffffff;
        padding: 20px;
        border-radius: ${config.borderRadius}px;
        box-shadow: 0 10px 30px rgba(0, 0, 0, 0.1);
        border: 2px solid #e1e5e9;
      }

      .game-cell {
        width: ${config.cellSize}px;
        height: ${config.cellSize}px;
        background: #f8f9fa;
        border: 2px solid #dee2e6;
        border-radius: ${config.borderRadius / 2}px;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: ${config.fontSize}px;
        font-weight: bold;
        cursor: pointer;
        transition: all 0.2s ease;
        user-select: none;
      }

      .game-cell:hover {
        background: #e9ecef;
        border-color: #adb5bd;
        transform: scale(1.02);
      }

      .game-cell.disabled {
        cursor: not-allowed;
        opacity: 0.7;
      }

      .game-cell.disabled:hover {
        background: #f8f9fa;
        border-color: #dee2e6;
        transform: none;
      }

      .game-cell .mark-x {
        color: #007bff;
        text-shadow: 2px 2px 4px rgba(0, 123, 255, 0.3);
      }

      .game-cell .mark-o {
        color: #dc3545;
        text-shadow: 2px 2px 4px rgba(220, 53, 69, 0.3);
      }

      .game-cell.winning {
        background: #28a745 !important;
        border-color: #1e7e34 !important;
        animation: pulse-win 0.6s ease-in-out;
      }

      .game-cell.winning .mark-x,
      .game-cell.winning .mark-o {
        color: #ffffff !important;
        text-shadow: 2px 2px 4px rgba(0, 0, 0, 0.3);
      }

      @keyframes pulse-win {
        0% { transform: scale(1); }
        50% { transform: scale(1.05); }
        100% { transform: scale(1); }
      }

      .game-status {
        text-align: center;
        font-size: 24px;
        font-weight: 600;
        color: #495057;
        min-height: 32px;
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .game-status.winner {
        color: #28a745;
        font-size: 28px;
      }

      .game-status.draw {
        color: #ffc107;
        font-size: 28px;
      }

      .game-controls {
        display: flex;
        gap: 15px;
        flex-wrap: wrap;
        justify-content: center;
      }

      .btn {
        padding: 12px 24px;
        border: none;
        border-radius: ${config.borderRadius / 2}px;
        font-size: 16px;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.2s ease;
        text-decoration: none;
        display: inline-block;
        text-align: center;
      }

      .btn-primary {
        background: #007bff;
        color: white;
      }

      .btn-primary:hover {
        background: #0056b3;
        transform: translateY(-2px);
        box-shadow: 0 4px 12px rgba(0, 123, 255, 0.3);
      }

      .btn-secondary {
        background: #6c757d;
        color: white;
      }

      .btn-secondary:hover {
        background: #545b62;
        transform: translateY(-2px);
        box-shadow: 0 4px 12px rgba(108, 117, 125, 0.3);
      }

      .lobby-container {
        max-width: 600px;
        width: 100%;
        background: white;
        border-radius: ${config.borderRadius}px;
        padding: 30px;
        box-shadow: 0 10px 30px rgba(0, 0, 0, 0.1);
        border: 2px solid #e1e5e9;
      }

      .lobby-title {
        font-size: 32px;
        font-weight: 700;
        text-align: center;
        color: #495057;
        margin-bottom: 30px;
      }

      .lobby-section {
        margin-bottom: 25px;
      }

      .lobby-section h3 {
        font-size: 20px;
        font-weight: 600;
        color: #495057;
        margin-bottom: 15px;
      }

      .input-group {
        display: flex;
        gap: 10px;
        margin-bottom: 15px;
      }

      .form-input {
        flex: 1;
        padding: 12px 16px;
        border: 2px solid #dee2e6;
        border-radius: ${config.borderRadius / 2}px;
        font-size: 16px;
        transition: border-color 0.2s ease;
      }

      .form-input:focus {
        outline: none;
        border-color: #007bff;
        box-shadow: 0 0 0 3px rgba(0, 123, 255, 0.1);
      }

      .game-list {
        list-style: none;
        padding: 0;
      }

      .game-item {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 15px;
        background: #f8f9fa;
        border: 1px solid #dee2e6;
        border-radius: ${config.borderRadius / 2}px;
        margin-bottom: 10px;
      }

      .game-item:hover {
        background: #e9ecef;
      }

      @media (max-width: ${this.breakpoints.mobile}px) {
        .game-container {
          gap: 20px;
        }
        
        .game-board {
          padding: 15px;
        }
        
        .lobby-container {
          padding: 20px;
          margin: 10px;
        }
        
        .lobby-title {
          font-size: 28px;
        }
        
        .input-group {
          flex-direction: column;
        }
        
        .game-controls {
          flex-direction: column;
          width: 100%;
        }
        
        .btn {
          width: 100%;
        }
      }

      @media (max-width: 480px) {
        body {
          padding: 10px;
        }
        
        .game-status {
          font-size: 20px;
        }
        
        .game-status.winner,
        .game-status.draw {
          font-size: 24px;
        }
      }
    `;
  }

  public applyStyles(): void {
    // No-op for server-side rendering
  }

  public getConfig(): StyleConfig {
    return { ...this.currentConfig };
  }

  public getCellClass(mark: 'X' | 'O' | null, isWinning: boolean, isDisabled: boolean): string {
    const classes = ['game-cell'];
    
    if (isWinning) classes.push('winning');
    if (isDisabled) classes.push('disabled');
    
    return classes.join(' ');
  }

  public getMarkClass(mark: 'X' | 'O'): string {
    return mark === 'X' ? 'mark-x' : 'mark-o';
  }

  public getStatusClass(status: 'playing' | 'winner' | 'draw'): string {
    const classes = ['game-status'];
    
    if (status === 'winner') classes.push('winner');
    if (status === 'draw') classes.push('draw');
    
    return classes.join(' ');
  }
}

export function createStylingManager(): StylingManager {
  return new StylingManager();
}

export function generateInlineStyles(config: StyleConfig): Record<string, string> {
  return {
    gameBoard: `
      display: grid;
      grid-template-columns: repeat(3, ${config.cellSize}px);
      grid-template-rows: repeat(3, ${config.cellSize}px);
      gap: ${config.gap}px;
      background: #ffffff;
      padding: 20px;
      border-radius: ${config.borderRadius}px;
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.1);
      border: 2px solid #e1e5e9;
    `,
    gameCell: `
      width: ${config.cellSize}px;
      height: ${config.cellSize}px;
      background: #f8f9fa;
      border: 2px solid #dee2e6;
      border-radius: ${config.borderRadius / 2}px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: ${config.fontSize}px;
      font-weight: bold;
      cursor: pointer;
      transition: all 0.2s ease;
      user-select: none;
    `,
    markX: 'color: #007bff; text-shadow: 2px 2px 4px rgba(0, 123, 255, 0.3);',
    markO: 'color: #dc3545; text-shadow: 2px 2px 4px rgba(220, 53, 69, 0.3);',
    winningCell: 'background: #28a745 !important; border-color: #1e7e34 !important;',
    winningMark: 'color: #ffffff !important; text-shadow: 2px 2px 4px rgba(0, 0, 0, 0.3);'
  };
}

/** @internal Phoenix VCS traceability — do not remove. */
export const _phoenix = {
  iu_id: 'b032e839d230050d790cdd029bcba6dba9f68d18afb93b2060152271b2b434ef',
  name: 'Styling',
  risk_tier: 'medium',
  canon_ids: [6 as const],
} as const;