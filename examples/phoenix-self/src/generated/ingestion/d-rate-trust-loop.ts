import { EventEmitter } from 'node:events';

export interface DRateMetrics {
  readonly currentDRate: number;
  readonly targetDRate: number;
  readonly windowSize: number;
  readonly totalChanges: number;
  readonly uncertainChanges: number;
  readonly isAlarmActive: boolean;
}

export interface DRateAlarmEvent {
  readonly timestamp: number;
  readonly dRate: number;
  readonly threshold: number;
  readonly windowSize: number;
}

export interface TrustDegradationWarning {
  readonly severity: 'warning' | 'critical';
  readonly message: string;
  readonly dRate: number;
  readonly recommendedActions: string[];
}

export interface OverrideFrictionConfig {
  readonly baseDelay: number;
  readonly escalationFactor: number;
  readonly maxDelay: number;
  readonly requiresJustification: boolean;
}

export type ChangeClassification = 'a' | 'b' | 'c' | 'd' | 'e';

export class DRateTrustLoop extends EventEmitter {
  private readonly TARGET_D_RATE = 0.05; // 5%
  private readonly ALARM_THRESHOLD = 0.15; // 15%
  private readonly windowSize: number;
  private readonly changeWindow: ChangeClassification[] = [];
  private alarmActive = false;
  private overrideFriction: OverrideFrictionConfig = {
    baseDelay: 1000,
    escalationFactor: 2.0,
    maxDelay: 30000,
    requiresJustification: false
  };

  constructor(windowSize = 100) {
    super();
    this.windowSize = windowSize;
  }

  recordChange(classification: ChangeClassification): void {
    this.changeWindow.push(classification);
    
    if (this.changeWindow.length > this.windowSize) {
      this.changeWindow.shift();
    }

    this.evaluateDRate();
  }

  private evaluateDRate(): void {
    const metrics = this.calculateMetrics();
    const wasAlarmActive = this.alarmActive;
    
    this.alarmActive = metrics.currentDRate > this.ALARM_THRESHOLD;

    if (this.alarmActive && !wasAlarmActive) {
      this.triggerAlarm(metrics);
    } else if (!this.alarmActive && wasAlarmActive) {
      this.clearAlarm();
    }
  }

  private calculateMetrics(): DRateMetrics {
    const totalChanges = this.changeWindow.length;
    const uncertainChanges = this.changeWindow.filter(c => c === 'd').length;
    const currentDRate = totalChanges > 0 ? uncertainChanges / totalChanges : 0;

    return {
      currentDRate,
      targetDRate: this.TARGET_D_RATE,
      windowSize: this.windowSize,
      totalChanges,
      uncertainChanges,
      isAlarmActive: this.alarmActive
    };
  }

  private triggerAlarm(metrics: DRateMetrics): void {
    const alarmEvent: DRateAlarmEvent = {
      timestamp: Date.now(),
      dRate: metrics.currentDRate,
      threshold: this.ALARM_THRESHOLD,
      windowSize: this.windowSize
    };

    this.increaseOverrideFriction();
    const warning = this.generateTrustDegradationWarning(metrics.currentDRate);

    this.emit('alarm', alarmEvent);
    this.emit('trustDegradation', warning);
    this.emit('overrideFrictionChanged', this.overrideFriction);
  }

  private clearAlarm(): void {
    this.resetOverrideFriction();
    this.emit('alarmCleared', { timestamp: Date.now() });
    this.emit('overrideFrictionChanged', this.overrideFriction);
  }

  private increaseOverrideFriction(): void {
    this.overrideFriction = {
      baseDelay: Math.min(this.overrideFriction.baseDelay * this.overrideFriction.escalationFactor, this.overrideFriction.maxDelay),
      escalationFactor: this.overrideFriction.escalationFactor,
      maxDelay: this.overrideFriction.maxDelay,
      requiresJustification: true
    };
  }

  private resetOverrideFriction(): void {
    this.overrideFriction = {
      baseDelay: 1000,
      escalationFactor: 2.0,
      maxDelay: 30000,
      requiresJustification: false
    };
  }

  private generateTrustDegradationWarning(dRate: number): TrustDegradationWarning {
    const severity = dRate > 0.25 ? 'critical' : 'warning';
    const percentage = Math.round(dRate * 100);
    
    return {
      severity,
      message: `Trust degradation detected: D-rate at ${percentage}% exceeds threshold of 15%. Classifier tuning required.`,
      dRate,
      recommendedActions: [
        'Review recent uncertain classifications for patterns',
        'Retrain classification models with recent data',
        'Adjust classification thresholds',
        'Consider manual review of borderline cases'
      ]
    };
  }

  getMetrics(): DRateMetrics {
    return this.calculateMetrics();
  }

  getOverrideFriction(): OverrideFrictionConfig {
    return { ...this.overrideFriction };
  }

  isAlarmTriggered(): boolean {
    return this.alarmActive;
  }

  reset(): void {
    this.changeWindow.length = 0;
    this.alarmActive = false;
    this.resetOverrideFriction();
    this.emit('reset', { timestamp: Date.now() });
  }
}

export function createDRateTrustLoop(windowSize?: number): DRateTrustLoop {
  return new DRateTrustLoop(windowSize);
}

/** @internal Phoenix VCS traceability — do not remove. */
export const _phoenix = {
  iu_id: '8d8eaf1f9a097d8ba4a1fd49534e801de9eebafe5dbee5b88b4da6b30093669e',
  name: 'D-Rate Trust Loop',
  risk_tier: 'high',
  canon_ids: [5 as const],
} as const;