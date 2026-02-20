export interface GridCell {
  x: number;
  y: number;
  ownerId: string | null;
  teamColor: string | null;
}

export interface GridState {
  cells: Map<string, GridCell>;
  gridSize: number;
  cellSize: number;
}

export interface PaintCommand {
  x: number;
  y: number;
  playerId: string;
}

export type PaintCommandHandler = (command: PaintCommand) => void;

export class GridRenderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private gridState: GridState;
  private hoveredCell: { x: number; y: number } | null = null;
  private onPaintCommand: PaintCommandHandler | null = null;
  private playerId: string = '';

  constructor(canvasElement: HTMLCanvasElement, gridSize: number = 50) {
    this.canvas = canvasElement;
    this.canvas.width = 500;
    this.canvas.height = 500;
    
    const context = this.canvas.getContext('2d');
    if (!context) {
      throw new Error('Failed to get 2D rendering context');
    }
    this.ctx = context;

    this.gridState = {
      cells: new Map(),
      gridSize,
      cellSize: 500 / gridSize
    };

    this.setupEventListeners();
    this.render();
  }

  public setPlayerId(playerId: string): void {
    this.playerId = playerId;
  }

  public setPaintCommandHandler(handler: PaintCommandHandler): void {
    this.onPaintCommand = handler;
  }

  public updateCell(x: number, y: number, ownerId: string | null, teamColor: string | null): void {
    const key = `${x},${y}`;
    this.gridState.cells.set(key, { x, y, ownerId, teamColor });
    this.render();
  }

  public updateGrid(cells: GridCell[]): void {
    this.gridState.cells.clear();
    for (const cell of cells) {
      const key = `${cell.x},${cell.y}`;
      this.gridState.cells.set(key, cell);
    }
    this.render();
  }

  private setupEventListeners(): void {
    this.canvas.addEventListener('mousemove', (event) => {
      const rect = this.canvas.getBoundingClientRect();
      const mouseX = event.clientX - rect.left;
      const mouseY = event.clientY - rect.top;
      
      const cellX = Math.floor(mouseX / this.gridState.cellSize);
      const cellY = Math.floor(mouseY / this.gridState.cellSize);
      
      if (cellX >= 0 && cellX < this.gridState.gridSize && 
          cellY >= 0 && cellY < this.gridState.gridSize) {
        if (!this.hoveredCell || this.hoveredCell.x !== cellX || this.hoveredCell.y !== cellY) {
          this.hoveredCell = { x: cellX, y: cellY };
          this.render();
        }
      } else {
        if (this.hoveredCell) {
          this.hoveredCell = null;
          this.render();
        }
      }
    });

    this.canvas.addEventListener('mouseleave', () => {
      if (this.hoveredCell) {
        this.hoveredCell = null;
        this.render();
      }
    });

    this.canvas.addEventListener('click', (event) => {
      const rect = this.canvas.getBoundingClientRect();
      const mouseX = event.clientX - rect.left;
      const mouseY = event.clientY - rect.top;
      
      const cellX = Math.floor(mouseX / this.gridState.cellSize);
      const cellY = Math.floor(mouseY / this.gridState.cellSize);
      
      if (cellX >= 0 && cellX < this.gridState.gridSize && 
          cellY >= 0 && cellY < this.gridState.gridSize) {
        if (this.onPaintCommand) {
          this.onPaintCommand({
            x: cellX,
            y: cellY,
            playerId: this.playerId
          });
        }
      }
    });
  }

  private render(): void {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    
    const { gridSize, cellSize } = this.gridState;
    
    for (let x = 0; x < gridSize; x++) {
      for (let y = 0; y < gridSize; y++) {
        const pixelX = x * cellSize;
        const pixelY = y * cellSize;
        
        const cellKey = `${x},${y}`;
        const cell = this.gridState.cells.get(cellKey);
        
        if (cell && cell.ownerId && cell.teamColor) {
          // Render owned cell with team color and glow
          this.ctx.fillStyle = cell.teamColor;
          this.ctx.fillRect(pixelX, pixelY, cellSize, cellSize);
          
          // Add subtle glow effect
          this.ctx.shadowColor = cell.teamColor;
          this.ctx.shadowBlur = 8;
          this.ctx.fillRect(pixelX + 1, pixelY + 1, cellSize - 2, cellSize - 2);
          this.ctx.shadowBlur = 0;
        } else {
          // Render empty cell as dark gray
          this.ctx.fillStyle = '#2a2a3e';
          this.ctx.fillRect(pixelX, pixelY, cellSize, cellSize);
        }
        
        // Add hover highlight
        if (this.hoveredCell && this.hoveredCell.x === x && this.hoveredCell.y === y) {
          this.ctx.strokeStyle = '#ffffff';
          this.ctx.lineWidth = 2;
          this.ctx.strokeRect(pixelX + 1, pixelY + 1, cellSize - 2, cellSize - 2);
        }
        
        // Draw grid lines
        this.ctx.strokeStyle = '#1a1a2e';
        this.ctx.lineWidth = 1;
        this.ctx.strokeRect(pixelX, pixelY, cellSize, cellSize);
      }
    }
  }
}

export function createGridCanvas(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = 500;
  canvas.height = 500;
  canvas.style.border = '1px solid #444';
  canvas.style.cursor = 'crosshair';
  return canvas;
}

export function generateGridHTML(containerId: string): string {
  return `
    <div id="${containerId}" style="display: flex; justify-content: center; align-items: center; padding: 20px;">
      <canvas id="game-grid" width="500" height="500" style="border: 1px solid #444; cursor: crosshair; background-color: #1a1a2e;"></canvas>
    </div>
  `;
}

/** @internal Phoenix VCS traceability — do not remove. */
export const _phoenix = {
  iu_id: 'd219e8bbb48e26fb3e3dad39edc3d9dd63fcdac50788f17f8224cb924096e840',
  name: 'Grid Rendering',
  risk_tier: 'medium',
  canon_ids: [6 as const],
} as const;