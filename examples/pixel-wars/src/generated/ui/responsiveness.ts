export interface ViewportDimensions {
  width: number;
  height: number;
}

export interface CanvasScaleInfo {
  scaleX: number;
  scaleY: number;
  offsetX: number;
  offsetY: number;
}

export interface TouchPoint {
  x: number;
  y: number;
  identifier: number;
}

export interface PointerEvent {
  x: number;
  y: number;
  type: 'mouse' | 'touch';
  identifier?: number;
}

export class ResponsivenessManager {
  private canvas: HTMLCanvasElement | null = null;
  private container: HTMLElement | null = null;
  private scaleInfo: CanvasScaleInfo = { scaleX: 1, scaleY: 1, offsetX: 0, offsetY: 0 };
  private resizeObserver: ResizeObserver | null = null;
  private pointerEventHandlers: Map<string, (event: PointerEvent) => void> = new Map();

  constructor() {
    this.handleResize = this.handleResize.bind(this);
    this.handleMouseEvent = this.handleMouseEvent.bind(this);
    this.handleTouchEvent = this.handleTouchEvent.bind(this);
  }

  public initialize(canvas: HTMLCanvasElement, container: HTMLElement): void {
    this.canvas = canvas;
    this.container = container;

    this.setupEventListeners();
    this.updateCanvasScale();

    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(this.handleResize);
      this.resizeObserver.observe(container);
    } else {
      window.addEventListener('resize', this.handleResize);
    }
  }

  public destroy(): void {
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    } else {
      window.removeEventListener('resize', this.handleResize);
    }

    this.removeEventListeners();
    this.canvas = null;
    this.container = null;
    this.pointerEventHandlers.clear();
  }

  public getViewportDimensions(): ViewportDimensions {
    if (!this.container) {
      return { width: 0, height: 0 };
    }

    const rect = this.container.getBoundingClientRect();
    return {
      width: rect.width,
      height: rect.height
    };
  }

  public getCanvasScaleInfo(): CanvasScaleInfo {
    return { ...this.scaleInfo };
  }

  public convertToCanvasCoordinates(screenX: number, screenY: number): { x: number; y: number } {
    if (!this.canvas) {
      return { x: screenX, y: screenY };
    }

    const rect = this.canvas.getBoundingClientRect();
    const relativeX = screenX - rect.left;
    const relativeY = screenY - rect.top;

    return {
      x: (relativeX - this.scaleInfo.offsetX) / this.scaleInfo.scaleX,
      y: (relativeY - this.scaleInfo.offsetY) / this.scaleInfo.scaleY
    };
  }

  public onPointerEvent(eventType: string, handler: (event: PointerEvent) => void): void {
    this.pointerEventHandlers.set(eventType, handler);
  }

  public removePointerEventHandler(eventType: string): void {
    this.pointerEventHandlers.delete(eventType);
  }

  private setupEventListeners(): void {
    if (!this.canvas) return;

    // Mouse events
    this.canvas.addEventListener('mousedown', this.handleMouseEvent);
    this.canvas.addEventListener('mousemove', this.handleMouseEvent);
    this.canvas.addEventListener('mouseup', this.handleMouseEvent);

    // Touch events
    this.canvas.addEventListener('touchstart', this.handleTouchEvent, { passive: false });
    this.canvas.addEventListener('touchmove', this.handleTouchEvent, { passive: false });
    this.canvas.addEventListener('touchend', this.handleTouchEvent, { passive: false });
  }

  private removeEventListeners(): void {
    if (!this.canvas) return;

    this.canvas.removeEventListener('mousedown', this.handleMouseEvent);
    this.canvas.removeEventListener('mousemove', this.handleMouseEvent);
    this.canvas.removeEventListener('mouseup', this.handleMouseEvent);

    this.canvas.removeEventListener('touchstart', this.handleTouchEvent);
    this.canvas.removeEventListener('touchmove', this.handleTouchEvent);
    this.canvas.removeEventListener('touchend', this.handleTouchEvent);
  }

  private handleResize(): void {
    this.updateCanvasScale();
  }

  private updateCanvasScale(): void {
    if (!this.canvas || !this.container) return;

    const containerRect = this.container.getBoundingClientRect();
    const canvasWidth = this.canvas.width;
    const canvasHeight = this.canvas.height;

    if (canvasWidth === 0 || canvasHeight === 0) return;

    const scaleX = containerRect.width / canvasWidth;
    const scaleY = containerRect.height / canvasHeight;
    const scale = Math.min(scaleX, scaleY);

    const scaledWidth = canvasWidth * scale;
    const scaledHeight = canvasHeight * scale;

    this.scaleInfo = {
      scaleX: scale,
      scaleY: scale,
      offsetX: (containerRect.width - scaledWidth) / 2,
      offsetY: (containerRect.height - scaledHeight) / 2
    };

    // Apply CSS transforms to scale the canvas
    this.canvas.style.transform = `scale(${scale})`;
    this.canvas.style.transformOrigin = 'top left';
    this.canvas.style.position = 'absolute';
    this.canvas.style.left = `${this.scaleInfo.offsetX}px`;
    this.canvas.style.top = `${this.scaleInfo.offsetY}px`;
  }

  private handleMouseEvent(event: MouseEvent): void {
    event.preventDefault();

    const canvasCoords = this.convertToCanvasCoordinates(event.clientX, event.clientY);
    const pointerEvent: PointerEvent = {
      x: canvasCoords.x,
      y: canvasCoords.y,
      type: 'mouse'
    };

    const handler = this.pointerEventHandlers.get(event.type);
    if (handler) {
      handler(pointerEvent);
    }
  }

  private handleTouchEvent(event: TouchEvent): void {
    event.preventDefault();

    const eventType = this.mapTouchEventType(event.type);
    const handler = this.pointerEventHandlers.get(eventType);
    
    if (!handler) return;

    // Process each touch point
    const touches = event.type === 'touchend' ? event.changedTouches : event.touches;
    
    for (let i = 0; i < touches.length; i++) {
      const touch = touches[i];
      const canvasCoords = this.convertToCanvasCoordinates(touch.clientX, touch.clientY);
      
      const pointerEvent: PointerEvent = {
        x: canvasCoords.x,
        y: canvasCoords.y,
        type: 'touch',
        identifier: touch.identifier
      };

      handler(pointerEvent);
    }
  }

  private mapTouchEventType(touchEventType: string): string {
    switch (touchEventType) {
      case 'touchstart':
        return 'mousedown';
      case 'touchmove':
        return 'mousemove';
      case 'touchend':
        return 'mouseup';
      default:
        return touchEventType;
    }
  }
}

export function createResponsivenessManager(): ResponsivenessManager {
  return new ResponsivenessManager();
}

export function isMobileDevice(): boolean {
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
}

export function getDevicePixelRatio(): number {
  return window.devicePixelRatio || 1;
}

/** @internal Phoenix VCS traceability — do not remove. */
export const _phoenix = {
  iu_id: '34e0a94555fd05dabb716eb8d9f35d4ad180e267ff13ca20cc74e1b3326659db',
  name: 'Responsiveness',
  risk_tier: 'low',
  canon_ids: [2 as const],
} as const;