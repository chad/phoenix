/**
 * D-Rate Tracker
 *
 * Tracks the rate of D-class (uncertain) classifications
 * over a rolling window.
 */

import type { ChangeClassification, DRateStatus } from './models/classification.js';
import { ChangeClass, DRateLevel } from './models/classification.js';

const DEFAULT_WINDOW_SIZE = 100;

export class DRateTracker {
  private window: ChangeClass[] = [];
  private windowSize: number;

  constructor(windowSize: number = DEFAULT_WINDOW_SIZE) {
    // A non-positive window self-evicts every record, masking the true D-rate as 0%.
    if (!Number.isInteger(windowSize) || windowSize < 1) {
      throw new RangeError('windowSize must be a positive integer');
    }
    this.windowSize = windowSize;
  }

  /**
   * Record a batch of classifications.
   */
  record(classifications: ChangeClassification[]): void {
    for (const c of classifications) {
      this.window.push(c.change_class);
      if (this.window.length > this.windowSize) {
        this.window.shift();
      }
    }
  }

  /**
   * Record a single classification.
   */
  recordOne(changeClass: ChangeClass): void {
    this.window.push(changeClass);
    if (this.window.length > this.windowSize) {
      this.window.shift();
    }
  }

  /**
   * Get current D-rate status.
   */
  getStatus(): DRateStatus {
    const total = this.window.length;
    if (total === 0) {
      return {
        rate: 0,
        level: DRateLevel.TARGET,
        window_size: this.windowSize,
        d_count: 0,
        total_count: 0,
      };
    }

    const dCount = this.window.filter(c => c === ChangeClass.D).length;
    const rate = dCount / total;
    const level = rateToLevel(rate);

    return {
      rate,
      level,
      window_size: this.windowSize,
      d_count: dCount,
      total_count: total,
    };
  }

  /**
   * Reset the tracker.
   */
  reset(): void {
    this.window = [];
  }
}

function rateToLevel(rate: number): DRateLevel {
  if (rate <= 0.05) return DRateLevel.TARGET;
  if (rate <= 0.10) return DRateLevel.ACCEPTABLE;
  if (rate <= 0.15) return DRateLevel.WARNING;
  return DRateLevel.ALARM;
}
