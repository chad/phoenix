export interface GameState {
  board: ('X' | 'O' | null)[];
  currentPlayer: 'X' | 'O';
  winner: 'X' | 'O' | 'draw' | null;
  winningLine: number[] | null;
  isPlayerTurn: boolean;
}

export interface MoveHandler {
  (cellIndex: number): void;
}

export class GameBoardUI {
  private gameState: GameState;
  private onMove: MoveHandler | null = null;

  constructor() {
    this.gameState = {
      board: Array(9).fill(null),
      currentPlayer: 'X',
      winner: null,
      winningLine: null,
      isPlayerTurn: true,
    };
  }

  public setMoveHandler(handler: MoveHandler): void {
    this.onMove = handler;
  }

  public updateGameState(state: Partial<GameState>): void {
    this.gameState = { ...this.gameState, ...state };
  }

  public generateHTML(): string {
    const cells = this.gameState.board.map((cell, index) => {
      const cellValue = cell || '';
      const isClickable = this.isCellClickable(index);
      const isWinningCell = this.gameState.winningLine?.includes(index) || false;
      
      const cellClass = [
        'game-cell',
        isClickable ? 'clickable' : 'disabled',
        isWinningCell ? 'winning-cell' : '',
        cellValue.toLowerCase()
      ].filter(Boolean).join(' ');

      return `<div class="${cellClass}" data-cell-index="${index}" onclick="handleCellClick(${index})">${cellValue}</div>`;
    }).join('');

    return `
      <div class="game-board">
        ${cells}
      </div>
    `;
  }

  public handleCellClick(cellIndex: number): void {
    if (!this.isCellClickable(cellIndex)) return;
    if (!this.onMove) return;

    this.onMove(cellIndex);
  }

  private isCellClickable(cellIndex: number): boolean {
    // Cell must be empty
    if (this.gameState.board[cellIndex] !== null) return false;
    
    // Game must not be over
    if (this.gameState.winner !== null) return false;
    
    // Must be player's turn
    if (!this.gameState.isPlayerTurn) return false;

    return true;
  }

  public reset(): void {
    this.gameState = {
      board: Array(9).fill(null),
      currentPlayer: 'X',
      winner: null,
      winningLine: null,
      isPlayerTurn: true,
    };
  }

  public getGameState(): GameState {
    return { ...this.gameState };
  }
}

export function createGameBoard(): GameBoardUI {
  return new GameBoardUI();
}

export function calculateWinningLine(board: ('X' | 'O' | null)[]): number[] | null {
  const winPatterns = [
    [0, 1, 2], [3, 4, 5], [6, 7, 8], // rows
    [0, 3, 6], [1, 4, 7], [2, 5, 8], // columns
    [0, 4, 8], [2, 4, 6]             // diagonals
  ];

  for (const pattern of winPatterns) {
    const [a, b, c] = pattern;
    if (board[a] && board[a] === board[b] && board[a] === board[c]) {
      return pattern;
    }
  }

  return null;
}

export function checkGameWinner(board: ('X' | 'O' | null)[]): 'X' | 'O' | 'draw' | null {
  const winningLine = calculateWinningLine(board);
  if (winningLine) {
    return board[winningLine[0]] as 'X' | 'O';
  }

  // Check for draw
  if (board.every(cell => cell !== null)) {
    return 'draw';
  }

  return null;
}

/** @internal Phoenix VCS traceability — do not remove. */
export const _phoenix = {
  iu_id: '7d36f47fe6080845a9c19e42491b8d549fdfe229119d5136091b38eab02d4783',
  name: 'Game Board UI',
  risk_tier: 'high',
  canon_ids: [6 as const],
} as const;