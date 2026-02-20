import { EventEmitter } from 'node:events';

export interface TeamScore {
  teamId: string;
  score: number;
  cellsCaptured: number;
}

export interface RoundState {
  roundNumber: number;
  isActive: boolean;
  timeRemaining: number;
  scores: Map<string, TeamScore>;
  startTime: number;
  endTime: number | null;
}

export interface RoundEndResult {
  roundNumber: number;
  finalScores: TeamScore[];
  winningTeam: TeamScore | null;
  endTime: number;
}

export interface ScoringEvents {
  timeUpdate: (timeRemaining: number) => void;
  roundEnd: (result: RoundEndResult) => void;
  roundStart: (roundNumber: number) => void;
  gridReset: () => void;
}

export class ScoringManager extends EventEmitter {
  private currentRound: RoundState;
  private roundDuration: number;
  private newRoundDelay: number;
  private timeUpdateInterval: NodeJS.Timeout | null = null;
  private newRoundTimeout: NodeJS.Timeout | null = null;

  constructor(roundDurationMs: number = 300000, newRoundDelayMs: number = 10000) {
    super();
    this.roundDuration = roundDurationMs;
    this.newRoundDelay = newRoundDelayMs;
    this.currentRound = this.createInitialRound();
  }

  private createInitialRound(): RoundState {
    return {
      roundNumber: 1,
      isActive: false,
      timeRemaining: this.roundDuration,
      scores: new Map(),
      startTime: 0,
      endTime: null,
    };
  }

  public startRound(): void {
    if (this.currentRound.isActive) {
      return;
    }

    this.currentRound.isActive = true;
    this.currentRound.startTime = Date.now();
    this.currentRound.timeRemaining = this.roundDuration;
    this.currentRound.endTime = null;
    this.currentRound.scores.clear();

    this.emit('roundStart', this.currentRound.roundNumber);
    this.emit('gridReset');

    this.startTimeUpdates();
  }

  private startTimeUpdates(): void {
    if (this.timeUpdateInterval) {
      clearInterval(this.timeUpdateInterval);
    }

    this.timeUpdateInterval = setInterval(() => {
      if (!this.currentRound.isActive) {
        return;
      }

      const elapsed = Date.now() - this.currentRound.startTime;
      this.currentRound.timeRemaining = Math.max(0, this.roundDuration - elapsed);

      this.emit('timeUpdate', this.currentRound.timeRemaining);

      if (this.currentRound.timeRemaining <= 0) {
        this.endRound();
      }
    }, 1000);
  }

  private endRound(): void {
    if (!this.currentRound.isActive) {
      return;
    }

    this.currentRound.isActive = false;
    this.currentRound.endTime = Date.now();

    if (this.timeUpdateInterval) {
      clearInterval(this.timeUpdateInterval);
      this.timeUpdateInterval = null;
    }

    const finalScores = Array.from(this.currentRound.scores.values())
      .sort((a, b) => b.score - a.score);

    const winningTeam = finalScores.length > 0 ? finalScores[0] : null;

    const result: RoundEndResult = {
      roundNumber: this.currentRound.roundNumber,
      finalScores,
      winningTeam,
      endTime: this.currentRound.endTime,
    };

    this.emit('roundEnd', result);

    this.scheduleNewRound();
  }

  private scheduleNewRound(): void {
    if (this.newRoundTimeout) {
      clearTimeout(this.newRoundTimeout);
    }

    this.newRoundTimeout = setTimeout(() => {
      this.currentRound = {
        roundNumber: this.currentRound.roundNumber + 1,
        isActive: false,
        timeRemaining: this.roundDuration,
        scores: new Map(),
        startTime: 0,
        endTime: null,
      };

      this.startRound();
    }, this.newRoundDelay);
  }

  public updateTeamScore(teamId: string, cellsCaptured: number): void {
    if (!this.currentRound.isActive) {
      return;
    }

    const score = cellsCaptured * 10; // 10 points per cell
    this.currentRound.scores.set(teamId, {
      teamId,
      score,
      cellsCaptured,
    });
  }

  public getCurrentRound(): RoundState {
    return { ...this.currentRound };
  }

  public getTimeRemaining(): number {
    return this.currentRound.timeRemaining;
  }

  public isRoundActive(): boolean {
    return this.currentRound.isActive;
  }

  public forceEndRound(): void {
    if (this.currentRound.isActive) {
      this.endRound();
    }
  }

  public cleanup(): void {
    if (this.timeUpdateInterval) {
      clearInterval(this.timeUpdateInterval);
      this.timeUpdateInterval = null;
    }

    if (this.newRoundTimeout) {
      clearTimeout(this.newRoundTimeout);
      this.newRoundTimeout = null;
    }

    this.removeAllListeners();
  }
}

export function createScoringManager(roundDurationMs?: number, newRoundDelayMs?: number): ScoringManager {
  return new ScoringManager(roundDurationMs, newRoundDelayMs);
}

/** @internal Phoenix VCS traceability — do not remove. */
export const _phoenix = {
  iu_id: 'ea816b6c57e8b7f05a5120f4c19742f529e46c8f12481976353a4250523c9b50',
  name: 'Scoring and Rounds',
  risk_tier: 'medium',
  canon_ids: [4 as const],
} as const;