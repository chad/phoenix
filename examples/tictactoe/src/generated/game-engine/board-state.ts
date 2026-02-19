export type CellState = 'empty' | 'x' | 'o';

export type BoardPosition = {
  row: number;
  col: number;
};

export type BoardGrid = CellState[][];

export class BoardState {
  private grid: BoardGrid;

  constructor() {
    this.grid = this.createEmptyGrid();
  }

  private createEmptyGrid(): BoardGrid {
    return Array.from({ length: 3 }, () => 
      Array.from({ length: 3 }, () => 'empty' as CellState)
    );
  }

  public getCell(position: BoardPosition): CellState {
    this.validatePosition(position);
    return this.grid[position.row][position.col];
  }

  public setCell(position: BoardPosition, state: CellState): void {
    this.validatePosition(position);
    this.grid[position.row][position.col] = state;
  }

  public getGrid(): BoardGrid {
    return this.grid.map(row => [...row]);
  }

  public reset(): void {
    this.grid = this.createEmptyGrid();
  }

  public serialize(): string {
    return this.grid
      .flat()
      .map(cell => {
        switch (cell) {
          case 'empty': return '-';
          case 'x': return 'x';
          case 'o': return 'o';
          default: return '-';
        }
      })
      .join('');
  }

  public deserialize(serialized: string): void {
    if (serialized.length !== 9) {
      throw new Error('Serialized board must be exactly 9 characters');
    }

    const validChars = /^[xo\-]+$/;
    if (!validChars.test(serialized)) {
      throw new Error('Serialized board contains invalid characters. Only x, o, and - are allowed');
    }

    this.grid = [];
    for (let row = 0; row < 3; row++) {
      this.grid[row] = [];
      for (let col = 0; col < 3; col++) {
        const index = row * 3 + col;
        const char = serialized[index];
        switch (char) {
          case 'x':
            this.grid[row][col] = 'x';
            break;
          case 'o':
            this.grid[row][col] = 'o';
            break;
          case '-':
            this.grid[row][col] = 'empty';
            break;
          default:
            this.grid[row][col] = 'empty';
        }
      }
    }
  }

  public isEmpty(position: BoardPosition): boolean {
    return this.getCell(position) === 'empty';
  }

  public getAllEmptyPositions(): BoardPosition[] {
    const positions: BoardPosition[] = [];
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 3; col++) {
        if (this.grid[row][col] === 'empty') {
          positions.push({ row, col });
        }
      }
    }
    return positions;
  }

  public isFull(): boolean {
    return this.getAllEmptyPositions().length === 0;
  }

  private validatePosition(position: BoardPosition): void {
    if (!Number.isInteger(position.row) || position.row < 0 || position.row > 2) {
      throw new Error('Row must be an integer between 0 and 2');
    }
    if (!Number.isInteger(position.col) || position.col < 0 || position.col > 2) {
      throw new Error('Column must be an integer between 0 and 2');
    }
  }
}

export function createBoard(): BoardState {
  return new BoardState();
}

export function createBoardFromSerialized(serialized: string): BoardState {
  const board = new BoardState();
  board.deserialize(serialized);
  return board;
}

/** @internal Phoenix VCS traceability — do not remove. */
export const _phoenix = {
  iu_id: 'bbb5317919f07fbf3ffc3f6a499be434ed4cd8368e12cf4a433bb8c7246c3520',
  name: 'Board State',
  risk_tier: 'medium',
  canon_ids: [4 as const],
} as const;