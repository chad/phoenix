export type ChangeClass = 'a' | 'b' | 'c' | 'd';

export interface ClassificationSignals {
  normalizedEditDistance: number;
  semhashDelta: number;
  contextHashDelta: number;
  termReferenceDeltas: number;
  sectionStructureDeltas: number;
}

export interface ClassificationResult {
  class: ChangeClass;
  confidence: number;
  signals: ClassificationSignals;
  requiresReview: boolean;
  reasoning: string;
}

export interface ClassificationThresholds {
  trivial: {
    maxEditDistance: number;
    maxSemhashDelta: number;
    maxContextDelta: number;
    maxTermDeltas: number;
    maxStructureDeltas: number;
  };
  localSemantic: {
    maxEditDistance: number;
    maxSemhashDelta: number;
    maxContextDelta: number;
    maxTermDeltas: number;
    maxStructureDeltas: number;
  };
  contextualShift: {
    maxEditDistance: number;
    maxSemhashDelta: number;
    maxContextDelta: number;
    maxTermDeltas: number;
    maxStructureDeltas: number;
  };
}

const DEFAULT_THRESHOLDS: ClassificationThresholds = {
  trivial: {
    maxEditDistance: 0.1,
    maxSemhashDelta: 0.05,
    maxContextDelta: 0.02,
    maxTermDeltas: 1,
    maxStructureDeltas: 0,
  },
  localSemantic: {
    maxEditDistance: 0.3,
    maxSemhashDelta: 0.2,
    maxContextDelta: 0.1,
    maxTermDeltas: 3,
    maxStructureDeltas: 1,
  },
  contextualShift: {
    maxEditDistance: 0.6,
    maxSemhashDelta: 0.4,
    maxContextDelta: 0.3,
    maxTermDeltas: 8,
    maxStructureDeltas: 3,
  },
};

export class ChangeClassifier {
  private thresholds: ClassificationThresholds;

  constructor(thresholds: ClassificationThresholds = DEFAULT_THRESHOLDS) {
    this.thresholds = thresholds;
  }

  classify(signals: ClassificationSignals): ClassificationResult {
    const { normalizedEditDistance, semhashDelta, contextHashDelta, termReferenceDeltas, sectionStructureDeltas } = signals;

    // Check for trivial changes (class a)
    if (this.meetsThresholds(signals, this.thresholds.trivial)) {
      return {
        class: 'a',
        confidence: this.calculateConfidence(signals, 'a'),
        signals,
        requiresReview: false,
        reasoning: 'Minimal changes across all metrics indicate trivial modification',
      };
    }

    // Check for local semantic changes (class b)
    if (this.meetsThresholds(signals, this.thresholds.localSemantic)) {
      return {
        class: 'b',
        confidence: this.calculateConfidence(signals, 'b'),
        signals,
        requiresReview: false,
        reasoning: 'Moderate semantic changes with limited structural impact',
      };
    }

    // Check for contextual shift (class c)
    if (this.meetsThresholds(signals, this.thresholds.contextualShift)) {
      return {
        class: 'c',
        confidence: this.calculateConfidence(signals, 'c'),
        signals,
        requiresReview: false,
        reasoning: 'Significant contextual or structural changes detected',
      };
    }

    // Default to uncertain (class d) - requires review
    return {
      class: 'd',
      confidence: 0.5,
      signals,
      requiresReview: true,
      reasoning: 'Changes exceed classification thresholds, manual review required',
    };
  }

  private meetsThresholds(signals: ClassificationSignals, thresholds: ClassificationThresholds['trivial']): boolean {
    return (
      signals.normalizedEditDistance <= thresholds.maxEditDistance &&
      signals.semhashDelta <= thresholds.maxSemhashDelta &&
      signals.contextHashDelta <= thresholds.maxContextDelta &&
      signals.termReferenceDeltas <= thresholds.maxTermDeltas &&
      signals.sectionStructureDeltas <= thresholds.maxStructureDeltas
    );
  }

  private calculateConfidence(signals: ClassificationSignals, classification: ChangeClass): number {
    const weights = {
      editDistance: 0.25,
      semhash: 0.25,
      context: 0.2,
      termRef: 0.15,
      structure: 0.15,
    };

    let score = 0;
    const thresholds = this.getThresholdsForClass(classification);

    if (thresholds) {
      score += weights.editDistance * Math.max(0, 1 - (signals.normalizedEditDistance / thresholds.maxEditDistance));
      score += weights.semhash * Math.max(0, 1 - (signals.semhashDelta / thresholds.maxSemhashDelta));
      score += weights.context * Math.max(0, 1 - (signals.contextHashDelta / thresholds.maxContextDelta));
      score += weights.termRef * Math.max(0, 1 - (signals.termReferenceDeltas / thresholds.maxTermDeltas));
      score += weights.structure * Math.max(0, 1 - (signals.sectionStructureDeltas / Math.max(1, thresholds.maxStructureDeltas)));
    }

    return Math.min(1, Math.max(0, score));
  }

  private getThresholdsForClass(classification: ChangeClass): ClassificationThresholds['trivial'] | null {
    switch (classification) {
      case 'a': return this.thresholds.trivial;
      case 'b': return this.thresholds.localSemantic;
      case 'c': return this.thresholds.contextualShift;
      default: return null;
    }
  }

  updateThresholds(newThresholds: Partial<ClassificationThresholds>): void {
    this.thresholds = {
      trivial: { ...this.thresholds.trivial, ...newThresholds.trivial },
      localSemantic: { ...this.thresholds.localSemantic, ...newThresholds.localSemantic },
      contextualShift: { ...this.thresholds.contextualShift, ...newThresholds.contextualShift },
    };
  }
}

export function classifyChange(signals: ClassificationSignals, thresholds?: ClassificationThresholds): ClassificationResult {
  const classifier = new ChangeClassifier(thresholds);
  return classifier.classify(signals);
}

export function requiresHumanReview(result: ClassificationResult): boolean {
  return result.requiresReview || result.class === 'd';
}

export function getClassificationDescription(changeClass: ChangeClass): string {
  switch (changeClass) {
    case 'a': return 'Trivial change with minimal impact';
    case 'b': return 'Local semantic change with contained effects';
    case 'c': return 'Contextual shift with broader implications';
    case 'd': return 'Uncertain change requiring manual review';
    default: return 'Unknown classification';
  }
}

/** @internal Phoenix VCS traceability — do not remove. */
export const _phoenix = {
  iu_id: '71cf253bd2837e75bc7e46505a8b1682ad4a3a99154add270af1f2239bbd22cb',
  name: 'Change Classification',
  risk_tier: 'low',
  canon_ids: [3 as const],
} as const;