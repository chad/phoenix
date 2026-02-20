import { EventEmitter } from 'node:events';

export interface PaintRequest {
  playerId: string;
  teamColor: string;
  x: number;
  y: number;
  timestamp: number;
}

export interface PaintResult {
  success: boolean;
  error?: 'too_fast' | 'invalid_cell';
  paintRequest?: PaintRequest;
}

export interface GridCell {
  x: number;
  y: number;
  color: string | null;
  lastPaintedBy?: string;
  lastPaintedAt?: number;
}

export interface PaintBroadcast {
  type: 'paint';
  playerId: string;
  teamColor: string;
  x: number;
  y: number;
  timestamp: number;
}

export class PaintingSystem extends EventEmitter {
  private grid: Map<string, GridCell> = new Map();
  private playerCooldowns: Map<string, number> = new Map();
  private readonly cooldownMs = 500;
  private readonly gridWidth: number;
  private readonly gridHeight: number;

  constructor(gridWidth: number = 100, gridHeight: number = 100) {
    super();
    this.gridWidth = gridWidth;
    this.gridHeight = gridHeight;
    this.initializeGrid();
  }

  private initializeGrid(): void {
    for (let x = 0; x < this.gridWidth; x++) {
      for (let y = 0; y < this.gridHeight; y++) {
        const key = `${x},${y}`;
        this.grid.set(key, {
          x,
          y,
          color: null
        });
      }
    }
  }

  private getCellKey(x: number, y: number): string {
    return `${x},${y}`;
  }

  private isValidCoordinate(x: number, y: number): boolean {
    return x >= 0 && x < this.gridWidth && y >= 0 && y < this.gridHeight;
  }

  private checkCooldown(playerId: string, currentTime: number): boolean {
    const lastPaintTime = this.playerCooldowns.get(playerId);
    if (lastPaintTime === undefined) {
      return true;
    }
    return (currentTime - lastPaintTime) >= this.cooldownMs;
  }

  public paint(request: PaintRequest): PaintResult {
    const { playerId, teamColor, x, y, timestamp } = request;

    // Validate coordinates
    if (!this.isValidCoordinate(x, y)) {
      return {
        success: false,
        error: 'invalid_cell'
      };
    }

    // Check cooldown
    if (!this.checkCooldown(playerId, timestamp)) {
      return {
        success: false,
        error: 'too_fast'
      };
    }

    // Execute paint
    const cellKey = this.getCellKey(x, y);
    const cell = this.grid.get(cellKey)!;
    
    cell.color = teamColor;
    cell.lastPaintedBy = playerId;
    cell.lastPaintedAt = timestamp;

    // Update cooldown
    this.playerCooldowns.set(playerId, timestamp);

    // Broadcast to all connected players
    const broadcast: PaintBroadcast = {
      type: 'paint',
      playerId,
      teamColor,
      x,
      y,
      timestamp
    };

    this.emit('paint_broadcast', broadcast);

    return {
      success: true,
      paintRequest: request
    };
  }

  public getCell(x: number, y: number): GridCell | null {
    if (!this.isValidCoordinate(x, y)) {
      return null;
    }
    const cellKey = this.getCellKey(x, y);
    return this.grid.get(cellKey) || null;
  }

  public getGrid(): GridCell[] {
    return Array.from(this.grid.values());
  }

  public getPlayerLastPaintTime(playerId: string): number | null {
    return this.playerCooldowns.get(playerId) || null;
  }

  public getRemainingCooldown(playerId: string, currentTime: number): number {
    const lastPaintTime = this.playerCooldowns.get(playerId);
    if (lastPaintTime === undefined) {
      return 0;
    }
    const elapsed = currentTime - lastPaintTime;
    return Math.max(0, this.cooldownMs - elapsed);
  }

  public clearGrid(): void {
    this.initializeGrid();
  }

  public resetPlayerCooldowns(): void {
    this.playerCooldowns.clear();
  }
}

export function createPaintingSystem(gridWidth?: number, gridHeight?: number): PaintingSystem {
  return new PaintingSystem(gridWidth, gridHeight);
}

/** @internal Phoenix VCS traceability — do not remove. */
export const _phoenix = {
  iu_id: '87e1bdd71ee393347bccfae9daf2ed4a50a148cb1a1ef50bf02d87f9cdaeea9e',
  name: 'Painting',
  risk_tier: 'high',
  canon_ids: [7 as const],
} as const;