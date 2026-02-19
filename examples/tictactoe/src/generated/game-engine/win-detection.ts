export type Player = 'X' | 'O';
export type Cell = Player | null;
export type Board = Cell[];

export interface GameResult {
  winner: Player | null;
  isDraw: boolean;
  isGameOver: boolean;
  winningLine?: number[];
}

const WINNING_COMBINATIONS = [
  // Rows
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  // Columns
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  // Diagonals
  [0, 4, 8],
  [2, 4, 6]
];

export function checkWinner(board: Board): Player | null {
  for (const combination of WINNING_COMBINATIONS) {
    const [a, b, c] = combination;
    if (board[a] && board[a] === board[b] && board[a] === board[c]) {
      return board[a] as Player;
    }
  }
  return null;
}

export function getWinningLine(board: Board): number[] | undefined {
  for (const combination of WINNING_COMBINATIONS) {
    const [a, b, c] = combination;
    if (board[a] && board[a] === board[b] && board[a] === board[c]) {
      return combination;
    }
  }
  return undefined;
}

export function isDraw(board: Board): boolean {
  const winner = checkWinner(board);
  if (winner) {
    return false;
  }
  return board.every(cell => cell !== null);
}

export function isGameOver(board: Board): boolean {
  return checkWinner(board) !== null || isDraw(board);
}

export function detectWin(board: Board): GameResult {
  const winner = checkWinner(board);
  const gameIsDraw = isDraw(board);
  const gameIsOver = isGameOver(board);
  const winningLine = getWinningLine(board);

  return {
    winner,
    isDraw: gameIsDraw,
    isGameOver: gameIsOver,
    winningLine
  };
}

/** @internal Phoenix VCS traceability — do not remove. */
export const _phoenix = {
  iu_id: '92e6ffaf7c4681fb8fd36853cd932a1e314b8feffd7cbc998c0f5a67d0ae842c',
  name: 'Win Detection',
  risk_tier: 'low',
  canon_ids: [2 as const],
} as const;