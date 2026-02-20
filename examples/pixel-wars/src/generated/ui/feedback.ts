export interface FeedbackSystem {
  flashCell(row: number, col: number): void;
  showCooldownToast(): void;
  showWinOverlay(color: string): void;
  updateCooldownProgress(progress: number): void;
  destroy(): void;
}

export interface FeedbackOptions {
  gridContainer: HTMLElement;
  overlayContainer: HTMLElement;
  cooldownContainer: HTMLElement;
}

export class Feedback implements FeedbackSystem {
  private gridContainer: HTMLElement;
  private overlayContainer: HTMLElement;
  private cooldownContainer: HTMLElement;
  private activeFlashes = new Set<string>();
  private activeToast: HTMLElement | null = null;
  private activeOverlay: HTMLElement | null = null;
  private cooldownBar: HTMLElement | null = null;

  constructor(options: FeedbackOptions) {
    this.gridContainer = options.gridContainer;
    this.overlayContainer = options.overlayContainer;
    this.cooldownContainer = options.cooldownContainer;
    this.initializeCooldownBar();
  }

  private initializeCooldownBar(): void {
    this.cooldownBar = document.createElement('div');
    this.cooldownBar.style.cssText = `
      position: relative;
      width: 100%;
      height: 4px;
      background-color: #e0e0e0;
      border-radius: 2px;
      overflow: hidden;
      margin-top: 8px;
    `;

    const progressFill = document.createElement('div');
    progressFill.style.cssText = `
      position: absolute;
      top: 0;
      left: 0;
      height: 100%;
      width: 0%;
      background-color: #ff6b6b;
      border-radius: 2px;
      transition: width 0.1s ease-out;
    `;
    progressFill.setAttribute('data-progress-fill', 'true');

    this.cooldownBar.appendChild(progressFill);
    this.cooldownContainer.appendChild(this.cooldownBar);
  }

  flashCell(row: number, col: number): void {
    const cellKey = `${row}-${col}`;
    if (this.activeFlashes.has(cellKey)) {
      return;
    }

    const cell = this.gridContainer.querySelector(`[data-row="${row}"][data-col="${col}"]`) as HTMLElement;
    if (!cell) {
      return;
    }

    this.activeFlashes.add(cellKey);

    const originalBackground = cell.style.backgroundColor;
    const originalTransition = cell.style.transition;

    cell.style.transition = 'background-color 0.05s ease-out';
    cell.style.backgroundColor = '#ffffff';

    setTimeout(() => {
      cell.style.backgroundColor = originalBackground;
      
      setTimeout(() => {
        cell.style.transition = originalTransition;
        this.activeFlashes.delete(cellKey);
      }, 150);
    }, 100);
  }

  showCooldownToast(): void {
    if (this.activeToast) {
      return;
    }

    this.activeToast = document.createElement('div');
    this.activeToast.style.cssText = `
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      background-color: rgba(0, 0, 0, 0.8);
      color: white;
      padding: 12px 20px;
      border-radius: 8px;
      font-size: 14px;
      font-weight: 500;
      display: flex;
      align-items: center;
      gap: 8px;
      z-index: 1000;
      pointer-events: none;
      animation: fadeInOut 1s ease-in-out;
    `;

    this.activeToast.innerHTML = `
      <span style="font-size: 16px;">⏳</span>
      <span>Please wait...</span>
    `;

    const style = document.createElement('style');
    style.textContent = `
      @keyframes fadeInOut {
        0% { opacity: 0; transform: translate(-50%, -50%) scale(0.9); }
        20% { opacity: 1; transform: translate(-50%, -50%) scale(1); }
        80% { opacity: 1; transform: translate(-50%, -50%) scale(1); }
        100% { opacity: 0; transform: translate(-50%, -50%) scale(0.9); }
      }
    `;
    document.head.appendChild(style);

    this.overlayContainer.appendChild(this.activeToast);

    setTimeout(() => {
      if (this.activeToast) {
        this.overlayContainer.removeChild(this.activeToast);
        this.activeToast = null;
      }
      document.head.removeChild(style);
    }, 1000);
  }

  showWinOverlay(color: string): void {
    if (this.activeOverlay) {
      this.overlayContainer.removeChild(this.activeOverlay);
    }

    this.activeOverlay = document.createElement('div');
    this.activeOverlay.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100vw;
      height: 100vh;
      background-color: rgba(0, 0, 0, 0.9);
      display: flex;
      flex-direction: column;
      justify-content: center;
      align-items: center;
      z-index: 2000;
      color: white;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      animation: winOverlayFadeIn 0.3s ease-out;
    `;

    const trophy = document.createElement('div');
    trophy.style.cssText = `
      font-size: 80px;
      margin-bottom: 20px;
      animation: trophyBounce 0.6s ease-out;
    `;
    trophy.textContent = '🏆';

    const message = document.createElement('div');
    message.style.cssText = `
      font-size: 36px;
      font-weight: bold;
      text-align: center;
      text-transform: capitalize;
    `;
    message.textContent = `${color} wins!`;

    const style = document.createElement('style');
    style.textContent = `
      @keyframes winOverlayFadeIn {
        0% { opacity: 0; }
        100% { opacity: 1; }
      }
      @keyframes trophyBounce {
        0% { transform: scale(0.3) rotate(-10deg); }
        50% { transform: scale(1.1) rotate(5deg); }
        100% { transform: scale(1) rotate(0deg); }
      }
    `;
    document.head.appendChild(style);

    this.activeOverlay.appendChild(trophy);
    this.activeOverlay.appendChild(message);
    this.overlayContainer.appendChild(this.activeOverlay);

    setTimeout(() => {
      if (this.activeOverlay) {
        this.overlayContainer.removeChild(this.activeOverlay);
        this.activeOverlay = null;
      }
      document.head.removeChild(style);
    }, 5000);
  }

  updateCooldownProgress(progress: number): void {
    if (!this.cooldownBar) {
      return;
    }

    const progressFill = this.cooldownBar.querySelector('[data-progress-fill="true"]') as HTMLElement;
    if (progressFill) {
      const clampedProgress = Math.max(0, Math.min(100, progress));
      progressFill.style.width = `${clampedProgress}%`;
      
      if (clampedProgress === 0) {
        this.cooldownBar.style.opacity = '0';
      } else {
        this.cooldownBar.style.opacity = '1';
      }
    }
  }

  destroy(): void {
    this.activeFlashes.clear();
    
    if (this.activeToast) {
      this.overlayContainer.removeChild(this.activeToast);
      this.activeToast = null;
    }
    
    if (this.activeOverlay) {
      this.overlayContainer.removeChild(this.activeOverlay);
      this.activeOverlay = null;
    }
    
    if (this.cooldownBar) {
      this.cooldownContainer.removeChild(this.cooldownBar);
      this.cooldownBar = null;
    }
  }
}

export function createFeedback(options: FeedbackOptions): FeedbackSystem {
  return new Feedback(options);
}

/** @internal Phoenix VCS traceability — do not remove. */
export const _phoenix = {
  iu_id: '8c0b86ec528f506c5efc010e2cc6f79ae09fc81f25916d923f4cff73dee3a50f',
  name: 'Feedback',
  risk_tier: 'medium',
  canon_ids: [4 as const],
} as const;