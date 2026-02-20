export interface GridCell {
  isEmpty: boolean;
  value?: string;
}

export interface GridPosition {
  row: number;
  col: number;
}

export interface GridDimensions {
  rows: number;
  cols: number;
}

export class Grid {
  private cells: GridCell[][];
  private readonly dimensions: GridDimensions;

  constructor(rows: number = 10, cols: number = 10) {
    if (rows <= 0 || cols <= 0) {
      throw new Error('Grid dimensions must be positive integers');
    }
    
    this.dimensions = { rows, cols };
    this.cells = this.initializeEmptyGrid();
  }

  private initializeEmptyGrid(): GridCell[][] {
    const grid: GridCell[][] = [];
    for (let row = 0; row < this.dimensions.rows; row++) {
      grid[row] = [];
      for (let col = 0; col < this.dimensions.cols; col++) {
        grid[row][col] = { isEmpty: true };
      }
    }
    return grid;
  }

  public getCell(position: GridPosition): GridCell {
    this.validatePosition(position);
    return { ...this.cells[position.row][position.col] };
  }

  public setCell(position: GridPosition, value: string): void {
    this.validatePosition(position);
    this.cells[position.row][position.col] = {
      isEmpty: false,
      value
    };
  }

  public clearCell(position: GridPosition): void {
    this.validatePosition(position);
    this.cells[position.row][position.col] = { isEmpty: true };
  }

  public isEmpty(position: GridPosition): boolean {
    this.validatePosition(position);
    return this.cells[position.row][position.col].isEmpty;
  }

  public getDimensions(): GridDimensions {
    return { ...this.dimensions };
  }

  public getAllCells(): GridCell[][] {
    return this.cells.map(row => row.map(cell => ({ ...cell })));
  }

  public reset(): void {
    this.cells = this.initializeEmptyGrid();
  }

  public isValidPosition(position: GridPosition): boolean {
    return position.row >= 0 && 
           position.row < this.dimensions.rows &&
           position.col >= 0 && 
           position.col < this.dimensions.cols;
  }

  private validatePosition(position: GridPosition): void {
    if (!this.isValidPosition(position)) {
      throw new Error(`Invalid grid position: row ${position.row}, col ${position.col}`);
    }
  }

  public getEmptyCells(): GridPosition[] {
    const emptyCells: GridPosition[] = [];
    for (let row = 0; row < this.dimensions.rows; row++) {
      for (let col = 0; col < this.dimensions.cols; col++) {
        if (this.cells[row][col].isEmpty) {
          emptyCells.push({ row, col });
        }
      }
    }
    return emptyCells;
  }

  public getOccupiedCells(): GridPosition[] {
    const occupiedCells: GridPosition[] = [];
    for (let row = 0; row < this.dimensions.rows; row++) {
      for (let col = 0; col < this.dimensions.cols; col++) {
        if (!this.cells[row][col].isEmpty) {
          occupiedCells.push({ row, col });
        }
      }
    }
    return occupiedCells;
  }

  public isFull(): boolean {
    return this.getEmptyCells().length === 0;
  }

  public getTotalCells(): number {
    return this.dimensions.rows * this.dimensions.cols;
  }
}

export function createGrid(rows?: number, cols?: number): Grid {
  return new Grid(rows, cols);
}

/** @internal Phoenix VCS traceability — do not remove. */
export const _phoenix = {
  iu_id: '54402d513f568c24bdb33696d7728b336aebce2df635c3570e86a8269c39c664',
  name: 'Grid',
  risk_tier: 'low',
  canon_ids: [2 as const],
} as const;