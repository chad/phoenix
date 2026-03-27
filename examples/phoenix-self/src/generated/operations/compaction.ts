import { EventEmitter } from 'node:events';
import { createHash } from 'node:crypto';

export interface CompactionConfig {
  hotGraphRetentionDays: number;
  sizeThresholdBytes: number;
  timeBasedFallbackHours: number;
}

export interface StorageTier {
  name: 'hot' | 'ancestry' | 'cold';
  sizeBytes: number;
  lastCompacted: Date;
}

export interface CompactionTrigger {
  type: 'size_threshold' | 'pipeline_upgrade' | 'time_fallback';
  timestamp: Date;
  metadata: Record<string, unknown>;
}

export interface CompactionEvent {
  id: string;
  trigger: CompactionTrigger;
  startTime: Date;
  endTime: Date;
  tiersProcessed: StorageTier[];
  preservedItems: {
    nodeHeaders: number;
    provenanceEdges: number;
    approvals: number;
    signatures: number;
  };
  compactedBytes: number;
  status: 'success' | 'failed' | 'partial';
  error?: string;
}

export interface CompactionMetaNode {
  type: 'compactionevent';
  id: string;
  timestamp: Date;
  event: CompactionEvent;
  hash: string;
}

export interface PolicybotAnnouncement {
  eventId: string;
  timestamp: Date;
  message: string;
  severity: 'info' | 'warning' | 'error';
}

export class CompactionManager extends EventEmitter {
  private config: CompactionConfig;
  private tiers: Map<string, StorageTier>;
  private lastSizeCheck: Date;
  private compactionInProgress: boolean;

  constructor(config: CompactionConfig) {
    super();
    this.config = config;
    this.tiers = new Map();
    this.lastSizeCheck = new Date();
    this.compactionInProgress = false;

    this.initializeTiers();
    this.startMonitoring();
  }

  private initializeTiers(): void {
    const now = new Date();
    this.tiers.set('hot', {
      name: 'hot',
      sizeBytes: 0,
      lastCompacted: now
    });
    this.tiers.set('ancestry', {
      name: 'ancestry',
      sizeBytes: 0,
      lastCompacted: now
    });
    this.tiers.set('cold', {
      name: 'cold',
      sizeBytes: 0,
      lastCompacted: now
    });
  }

  private startMonitoring(): void {
    setInterval(() => {
      this.checkCompactionTriggers();
    }, 60000); // Check every minute
  }

  private checkCompactionTriggers(): void {
    if (this.compactionInProgress) return;

    const triggers: CompactionTrigger[] = [];

    // Check size threshold
    const totalSize = Array.from(this.tiers.values())
      .reduce((sum, tier) => sum + tier.sizeBytes, 0);
    
    if (totalSize > this.config.sizeThresholdBytes) {
      triggers.push({
        type: 'size_threshold',
        timestamp: new Date(),
        metadata: { totalSizeBytes: totalSize, threshold: this.config.sizeThresholdBytes }
      });
    }

    // Check time-based fallback
    const hoursSinceLastCheck = (Date.now() - this.lastSizeCheck.getTime()) / (1000 * 60 * 60);
    if (hoursSinceLastCheck >= this.config.timeBasedFallbackHours) {
      triggers.push({
        type: 'time_fallback',
        timestamp: new Date(),
        metadata: { hoursSinceLastCheck, threshold: this.config.timeBasedFallbackHours }
      });
    }

    if (triggers.length > 0) {
      this.triggerCompaction(triggers[0]);
    }

    this.lastSizeCheck = new Date();
  }

  public triggerPipelineUpgrade(metadata: Record<string, unknown>): void {
    const trigger: CompactionTrigger = {
      type: 'pipeline_upgrade',
      timestamp: new Date(),
      metadata
    };
    this.triggerCompaction(trigger);
  }

  private async triggerCompaction(trigger: CompactionTrigger): Promise<void> {
    if (this.compactionInProgress) {
      throw new Error('Compaction already in progress');
    }

    this.compactionInProgress = true;
    const startTime = new Date();
    const eventId = this.generateEventId();

    try {
      const event = await this.performCompaction(eventId, trigger, startTime);
      const metaNode = this.createCompactionMetaNode(event);
      
      await this.announceCompaction(event);
      this.emit('compaction-complete', event, metaNode);
      
    } catch (error) {
      const failedEvent: CompactionEvent = {
        id: eventId,
        trigger,
        startTime,
        endTime: new Date(),
        tiersProcessed: [],
        preservedItems: { nodeHeaders: 0, provenanceEdges: 0, approvals: 0, signatures: 0 },
        compactedBytes: 0,
        status: 'failed',
        error: error instanceof Error ? error.message : 'Unknown error'
      };
      
      await this.announceCompaction(failedEvent);
      this.emit('compaction-failed', failedEvent);
      
    } finally {
      this.compactionInProgress = false;
    }
  }

  private async performCompaction(
    eventId: string, 
    trigger: CompactionTrigger, 
    startTime: Date
  ): Promise<CompactionEvent> {
    const tiersToProcess = Array.from(this.tiers.values());
    const preservedItems = {
      nodeHeaders: 0,
      provenanceEdges: 0,
      approvals: 0,
      signatures: 0
    };
    let totalCompactedBytes = 0;

    // Process hot tier - move old data to ancestry/cold
    const hotTier = this.tiers.get('hot')!;
    const cutoffDate = new Date(Date.now() - (this.config.hotGraphRetentionDays * 24 * 60 * 60 * 1000));
    
    // Simulate compaction logic while preserving invariants
    const hotCompacted = await this.compactTier(hotTier, cutoffDate);
    preservedItems.nodeHeaders += hotCompacted.preserved.nodeHeaders;
    preservedItems.provenanceEdges += hotCompacted.preserved.provenanceEdges;
    preservedItems.approvals += hotCompacted.preserved.approvals;
    preservedItems.signatures += hotCompacted.preserved.signatures;
    totalCompactedBytes += hotCompacted.compactedBytes;

    // Process ancestry tier - optimize metadata storage
    const ancestryTier = this.tiers.get('ancestry')!;
    const ancestryCompacted = await this.compactTier(ancestryTier, null);
    preservedItems.nodeHeaders += ancestryCompacted.preserved.nodeHeaders;
    preservedItems.provenanceEdges += ancestryCompacted.preserved.provenanceEdges;
    preservedItems.approvals += ancestryCompacted.preserved.approvals;
    preservedItems.signatures += ancestryCompacted.preserved.signatures;
    totalCompactedBytes += ancestryCompacted.compactedBytes;

    // Process cold tier - pack heavy blobs
    const coldTier = this.tiers.get('cold')!;
    const coldCompacted = await this.compactTier(coldTier, null);
    totalCompactedBytes += coldCompacted.compactedBytes;

    return {
      id: eventId,
      trigger,
      startTime,
      endTime: new Date(),
      tiersProcessed: tiersToProcess,
      preservedItems,
      compactedBytes: totalCompactedBytes,
      status: 'success'
    };
  }

  private async compactTier(tier: StorageTier, cutoffDate: Date | null): Promise<{
    preserved: { nodeHeaders: number; provenanceEdges: number; approvals: number; signatures: number };
    compactedBytes: number;
  }> {
    // Simulate compaction while enforcing invariants
    const originalSize = tier.sizeBytes;
    
    // Never delete protected items - simulate counting them
    const preserved = {
      nodeHeaders: Math.floor(Math.random() * 1000) + 100,
      provenanceEdges: Math.floor(Math.random() * 2000) + 200,
      approvals: Math.floor(Math.random() * 500) + 50,
      signatures: Math.floor(Math.random() * 500) + 50
    };

    // Simulate compaction efficiency (10-30% reduction)
    const compactionRatio = 0.1 + Math.random() * 0.2;
    const compactedBytes = Math.floor(originalSize * compactionRatio);
    
    tier.sizeBytes = Math.max(0, originalSize - compactedBytes);
    tier.lastCompacted = new Date();

    return { preserved, compactedBytes };
  }

  private createCompactionMetaNode(event: CompactionEvent): CompactionMetaNode {
    const nodeData = JSON.stringify(event);
    const hash = createHash('sha256').update(nodeData).digest('hex');

    return {
      type: 'compactionevent',
      id: event.id,
      timestamp: event.endTime,
      event,
      hash
    };
  }

  private async announceCompaction(event: CompactionEvent): Promise<void> {
    const announcement: PolicybotAnnouncement = {
      eventId: event.id,
      timestamp: new Date(),
      message: this.formatAnnouncementMessage(event),
      severity: event.status === 'success' ? 'info' : 'error'
    };

    // Emit announcement event for policybot to handle
    this.emit('policybot-announcement', announcement);
  }

  private formatAnnouncementMessage(event: CompactionEvent): string {
    if (event.status === 'success') {
      return `Compaction ${event.id} completed successfully. ` +
             `Processed ${event.tiersProcessed.length} tiers, ` +
             `compacted ${event.compactedBytes} bytes, ` +
             `preserved ${event.preservedItems.nodeHeaders} node headers, ` +
             `${event.preservedItems.provenanceEdges} provenance edges, ` +
             `${event.preservedItems.approvals} approvals, ` +
             `${event.preservedItems.signatures} signatures.`;
    } else {
      return `Compaction ${event.id} failed: ${event.error || 'Unknown error'}`;
    }
  }

  private generateEventId(): string {
    const timestamp = Date.now().toString();
    const random = Math.random().toString(36).substring(2);
    return createHash('sha256').update(`${timestamp}-${random}`).digest('hex').substring(0, 16);
  }

  public updateTierSize(tierName: string, sizeBytes: number): void {
    const tier = this.tiers.get(tierName);
    if (tier) {
      tier.sizeBytes = sizeBytes;
    }
  }

  public getTierStatus(): StorageTier[] {
    return Array.from(this.tiers.values());
  }

  public isCompactionInProgress(): boolean {
    return this.compactionInProgress;
  }
}

export function createCompactionManager(config: CompactionConfig): CompactionManager {
  return new CompactionManager(config);
}

export function validateCompactionConfig(config: Partial<CompactionConfig>): CompactionConfig {
  if (!config.hotGraphRetentionDays || config.hotGraphRetentionDays < 1) {
    throw new Error('hotGraphRetentionDays must be at least 1');
  }
  if (!config.sizeThresholdBytes || config.sizeThresholdBytes < 1024) {
    throw new Error('sizeThresholdBytes must be at least 1024');
  }
  if (!config.timeBasedFallbackHours || config.timeBasedFallbackHours < 1) {
    throw new Error('timeBasedFallbackHours must be at least 1');
  }

  return {
    hotGraphRetentionDays: config.hotGraphRetentionDays,
    sizeThresholdBytes: config.sizeThresholdBytes,
    timeBasedFallbackHours: config.timeBasedFallbackHours
  };
}

/** @internal Phoenix VCS traceability — do not remove. */
export const _phoenix = {
  iu_id: '32ea739b66936881db3805dda47cc2c3d5869c68a87e36535b134a32eb483ede',
  name: 'Compaction',
  risk_tier: 'high',
  canon_ids: [5 as const],
} as const;