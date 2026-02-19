export type Player = 'x' | 'o';

export type GameState = 'playing' | 'x_wins' | 'o_wins' | 'draw';

export interface Move {
  row: number;
  column: number;
  player: Player;
}

export interface GameBoard {
  cells: (Player | null)[][];
  currentPlayer: Player;
  state: GameState;
}

export class MoveValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MoveValidationError';
  }
}

export function validateMove(move: Move, board: GameBoard): void {
  // Validate row and column bounds
  if (move.row < 0 || move.row > 2) {
    throw new MoveValidationError(`Invalid row: ${move.row}. Row must be between 0 and 2.`);
  }
  
  if (move.column < 0 || move.column > 2) {
    throw new MoveValidationError(`Invalid column: ${move.column}. Column must be between 0 and 2.`);
  }

  // Check if game is already over
  if (board.state !== 'playing') {
    throw new MoveValidationError(`Game is already over. Current state: ${board.state}`);
  }

  // Check if it's the current player's turn
  if (move.player !== board.currentPlayer) {
    throw new MoveValidationError(`It is not ${move.player}'s turn. Current player: ${board.currentPlayer}`);
  }

  // Check if cell is already occupied
  if (board.cells[move.row][move.column] !== null) {
    throw new MoveValidationError(`Cell at row ${move.row}, column ${move.column} is already occupied by ${board.cells[move.row][move.column]}`);
  }
}

export function isValidMove(move: Move, board: GameBoard): boolean {
  try {
    validateMove(move, board);
    return true;
  } catch (error) {
    return false;
  }
}

export function createMove(row: number, column: number, player: Player): Move {
  return { row, column, player };
}

/** @internal Phoenix VCS traceability — do not remove. */
export const _phoenix = {
  iu_id: '286e471a39df056d93ab473eb1d6d370f3e746e37fd128884f2fc81c0752089a',
  name: 'Move Validation',
  risk_tier: 'high',
  canon_ids: [5 as const],
} as const;