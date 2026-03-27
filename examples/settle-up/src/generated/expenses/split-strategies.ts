export interface Participant {
  id: string;
  name: string;
}

export interface SplitShare {
  participantId: string;
  amount: number;
  percentage: number;
}

export interface SplitResult {
  shares: SplitShare[];
  totalAmount: number;
  remainderAssignedTo?: string;
}

export interface PercentageSplit {
  participantId: string;
  percentage: number;
}

export class SplitValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SplitValidationError';
  }
}

export class SplitStrategies {
  /**
   * Splits an expense by custom percentages that must sum to 100%.
   */
  static splitByPercentages(
    totalAmount: number,
    percentageSplits: PercentageSplit[],
    payerId: string
  ): SplitResult {
    if (totalAmount <= 0) {
      throw new SplitValidationError('Total amount must be positive');
    }

    if (percentageSplits.length === 0) {
      throw new SplitValidationError('At least one participant is required');
    }

    // Validate percentages sum to 100
    const totalPercentage = percentageSplits.reduce((sum, split) => sum + split.percentage, 0);
    if (Math.abs(totalPercentage - 100) > 0.01) {
      throw new SplitValidationError(`Percentages must sum to 100%, got ${totalPercentage}%`);
    }

    // Validate all percentages are non-negative
    for (const split of percentageSplits) {
      if (split.percentage < 0) {
        throw new SplitValidationError(`Percentage cannot be negative: ${split.percentage}%`);
      }
    }

    // Validate payer is included in splits
    const payerIncluded = percentageSplits.some(split => split.participantId === payerId);
    if (!payerIncluded) {
      throw new SplitValidationError('Payer must be included in the split');
    }

    // Calculate shares with proper rounding
    const shares: SplitShare[] = [];
    let allocatedAmount = 0;

    for (const split of percentageSplits) {
      const calculatedAmount = Math.round((totalAmount * split.percentage) / 100);
      shares.push({
        participantId: split.participantId,
        amount: calculatedAmount,
        percentage: split.percentage
      });
      allocatedAmount += calculatedAmount;
    }

    // Handle remainder by assigning to payer
    const remainder = totalAmount - allocatedAmount;
    let remainderAssignedTo: string | undefined;

    if (remainder !== 0) {
      const payerShare = shares.find(share => share.participantId === payerId);
      if (payerShare) {
        payerShare.amount += remainder;
        remainderAssignedTo = payerId;
      }
    }

    // Verify invariant: sum equals total
    const finalSum = shares.reduce((sum, share) => sum + share.amount, 0);
    if (finalSum !== totalAmount) {
      throw new SplitValidationError(`Split calculation error: sum ${finalSum} does not equal total ${totalAmount}`);
    }

    return {
      shares,
      totalAmount,
      remainderAssignedTo
    };
  }

  /**
   * Splits an expense equally among all participants.
   */
  static splitEqually(
    totalAmount: number,
    participantIds: string[],
    payerId: string
  ): SplitResult {
    if (totalAmount <= 0) {
      throw new SplitValidationError('Total amount must be positive');
    }

    if (participantIds.length === 0) {
      throw new SplitValidationError('At least one participant is required');
    }

    // Validate payer is included
    if (!participantIds.includes(payerId)) {
      throw new SplitValidationError('Payer must be included in participants');
    }

    // Create equal percentage splits
    const equalPercentage = 100 / participantIds.length;
    const percentageSplits: PercentageSplit[] = participantIds.map(id => ({
      participantId: id,
      percentage: equalPercentage
    }));

    return this.splitByPercentages(totalAmount, percentageSplits, payerId);
  }

  /**
   * Validates that a split result maintains the required invariants.
   */
  static validateSplitResult(result: SplitResult): boolean {
    // Check that shares sum to total amount
    const sum = result.shares.reduce((total, share) => total + share.amount, 0);
    if (sum !== result.totalAmount) {
      return false;
    }

    // Check that all amounts are non-negative
    for (const share of result.shares) {
      if (share.amount < 0) {
        return false;
      }
    }

    // Check that percentages are valid
    for (const share of result.shares) {
      if (share.percentage < 0 || share.percentage > 100) {
        return false;
      }
    }

    return true;
  }

  /**
   * Recalculates a split when the total amount changes.
   */
  static recalculateSplit(
    originalResult: SplitResult,
    newTotalAmount: number,
    payerId: string
  ): SplitResult {
    if (newTotalAmount <= 0) {
      throw new SplitValidationError('New total amount must be positive');
    }

    // Extract percentage splits from original result
    const percentageSplits: PercentageSplit[] = originalResult.shares.map(share => ({
      participantId: share.participantId,
      percentage: share.percentage
    }));

    return this.splitByPercentages(newTotalAmount, percentageSplits, payerId);
  }
}

/** @internal Phoenix VCS traceability — do not remove. */
export const _phoenix = {
  iu_id: '99cbd78cfcb01ca2b8d67575834a6adec408c399d090c91868253f266e726337',
  name: 'Split Strategies',
  risk_tier: 'high',
  canon_ids: [3 as const],
} as const;