import { EventEmitter } from 'node:events';

export type SystemState = 'bootstrap_cold' | 'bootstrap_warming' | 'steady_state';

export type BootstrapPhase = 
  | 'cold_pass'
  | 'canonicalization'
  | 'warm_pass'
  | 'trust_dashboard'
  | 'set_warming_state'
  | 'completed';

export interface BootstrapConfig {
  dRateThreshold: number;
  stabilizationTimeMs: number;
  maxRetries: number;
}

export interface BootstrapState {
  currentPhase: BootstrapPhase;
  systemState: SystemState;
  lastCompletedPhase: BootstrapPhase | null;
  dRate: number;
  stabilizationStartTime: number | null;
  retryCount: number;
}

export interface BootstrapResult {
  success: boolean;
  finalState: SystemState;
  completedPhases: BootstrapPhase[];
  error?: string;
}

export class BootstrapFlow extends EventEmitter {
  private state: BootstrapState;
  private config: BootstrapConfig;
  private stabilizationTimer: NodeJS.Timeout | null = null;

  constructor(config: BootstrapConfig) {
    super();
    this.config = config;
    this.state = {
      currentPhase: 'cold_pass',
      systemState: 'bootstrap_cold',
      lastCompletedPhase: null,
      dRate: Infinity,
      stabilizationStartTime: null,
      retryCount: 0
    };
  }

  public async executeBootstrap(): Promise<BootstrapResult> {
    const completedPhases: BootstrapPhase[] = [];
    
    try {
      // Resume from last completed phase if interrupted
      const startPhase = this.getResumePhase();
      this.state.currentPhase = startPhase;

      const phases: BootstrapPhase[] = [
        'cold_pass',
        'canonicalization', 
        'warm_pass',
        'trust_dashboard',
        'set_warming_state'
      ];

      const startIndex = phases.indexOf(startPhase);
      
      for (let i = startIndex; i < phases.length; i++) {
        const phase = phases[i];
        this.state.currentPhase = phase;
        
        this.emit('phaseStarted', phase);
        
        const success = await this.executePhase(phase);
        if (!success) {
          throw new Error(`Bootstrap phase ${phase} failed`);
        }
        
        this.state.lastCompletedPhase = phase;
        completedPhases.push(phase);
        this.emit('phaseCompleted', phase);
      }

      // Wait for stabilization before transitioning to steady_state
      await this.waitForStabilization();
      
      this.state.systemState = 'steady_state';
      this.state.currentPhase = 'completed';
      
      this.emit('bootstrapCompleted');
      
      return {
        success: true,
        finalState: this.state.systemState,
        completedPhases
      };

    } catch (error) {
      this.emit('bootstrapFailed', error);
      return {
        success: false,
        finalState: this.state.systemState,
        completedPhases,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  private getResumePhase(): BootstrapPhase {
    if (!this.state.lastCompletedPhase) {
      return 'cold_pass';
    }

    const phaseOrder: BootstrapPhase[] = [
      'cold_pass',
      'canonicalization',
      'warm_pass', 
      'trust_dashboard',
      'set_warming_state'
    ];

    const lastIndex = phaseOrder.indexOf(this.state.lastCompletedPhase);
    const nextIndex = lastIndex + 1;
    
    return nextIndex < phaseOrder.length ? phaseOrder[nextIndex] : 'completed';
  }

  private async executePhase(phase: BootstrapPhase): Promise<boolean> {
    switch (phase) {
      case 'cold_pass':
        return this.executeColdPass();
      case 'canonicalization':
        return this.executeCanonicalization();
      case 'warm_pass':
        return this.executeWarmPass();
      case 'trust_dashboard':
        return this.generateTrustDashboard();
      case 'set_warming_state':
        return this.setWarmingState();
      default:
        return false;
    }
  }

  private async executeColdPass(): Promise<boolean> {
    this.state.systemState = 'bootstrap_cold';
    
    // Suppress d-rate alarms during cold phase
    this.suppressDRateAlarms(true);
    
    // Simulate cold pass operations
    await this.delay(100);
    
    this.emit('coldPassCompleted');
    return true;
  }

  private async executeCanonicalization(): Promise<boolean> {
    // Simulate canonicalization process
    await this.delay(50);
    
    this.emit('canonicalizationCompleted');
    return true;
  }

  private async executeWarmPass(): Promise<boolean> {
    // Simulate warm pass operations
    await this.delay(100);
    
    this.emit('warmPassCompleted');
    return true;
  }

  private async generateTrustDashboard(): Promise<boolean> {
    // Simulate trust dashboard generation
    await this.delay(75);
    
    this.emit('trustDashboardGenerated');
    return true;
  }

  private async setWarmingState(): Promise<boolean> {
    this.state.systemState = 'bootstrap_warming';
    
    // Downgrade severity during warming phase
    this.downgradeSeverity(true);
    
    // Re-enable d-rate alarms but with downgraded severity
    this.suppressDRateAlarms(false);
    
    this.emit('warmingStateSet');
    return true;
  }

  private async waitForStabilization(): Promise<void> {
    return new Promise((resolve, reject) => {
      const checkStabilization = () => {
        this.updateDRate();
        
        if (this.isDRateAcceptable()) {
          if (!this.state.stabilizationStartTime) {
            this.state.stabilizationStartTime = Date.now();
          }
          
          const stabilizationDuration = Date.now() - this.state.stabilizationStartTime;
          
          if (stabilizationDuration >= this.config.stabilizationTimeMs) {
            if (this.stabilizationTimer) {
              clearInterval(this.stabilizationTimer);
              this.stabilizationTimer = null;
            }
            resolve();
            return;
          }
        } else {
          // Reset stabilization timer if d-rate goes out of bounds
          this.state.stabilizationStartTime = null;
        }
      };

      this.stabilizationTimer = setInterval(checkStabilization, 100);
      
      // Timeout after reasonable period
      setTimeout(() => {
        if (this.stabilizationTimer) {
          clearInterval(this.stabilizationTimer);
          this.stabilizationTimer = null;
        }
        reject(new Error('Stabilization timeout - d-rate did not stabilize'));
      }, 30000);
    });
  }

  private updateDRate(): void {
    // Simulate d-rate calculation - in real implementation this would
    // interface with actual system metrics
    this.state.dRate = Math.random() * this.config.dRateThreshold * 2;
  }

  private isDRateAcceptable(): boolean {
    return this.state.dRate <= this.config.dRateThreshold;
  }

  private suppressDRateAlarms(suppress: boolean): void {
    this.emit('dRateAlarmsSuppressionChanged', suppress);
  }

  private downgradeSeverity(downgrade: boolean): void {
    this.emit('severityDowngradeChanged', downgrade);
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  public getState(): Readonly<BootstrapState> {
    return { ...this.state };
  }

  public getConfig(): Readonly<BootstrapConfig> {
    return { ...this.config };
  }

  public isBootstrapComplete(): boolean {
    return this.state.currentPhase === 'completed' && 
           this.state.systemState === 'steady_state';
  }

  public canTransitionToSteadyState(): boolean {
    return this.isDRateAcceptable() && 
           this.state.lastCompletedPhase === 'set_warming_state';
  }
}

export function createBootstrapFlow(config: BootstrapConfig): BootstrapFlow {
  return new BootstrapFlow(config);
}

export function getDefaultBootstrapConfig(): BootstrapConfig {
  return {
    dRateThreshold: 0.1,
    stabilizationTimeMs: 5000,
    maxRetries: 3
  };
}

/** @internal Phoenix VCS traceability — do not remove. */
export const _phoenix = {
  iu_id: '60f8a43e37c250c4a927b9fa5f47adbd4b63c0e77b17f4720e4ddef417af87d7',
  name: 'Bootstrap Flow',
  risk_tier: 'high',
  canon_ids: [7 as const],
} as const;