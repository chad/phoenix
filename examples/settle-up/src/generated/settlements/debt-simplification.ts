export interface Balance {
  memberId: string;
  amount: number;
}

export interface Payment {
  payer: string;
  payee: string;
  amount: number;
}

export interface SettlementPlan {
  payments: Payment[];
}

export interface DebtGroup {
  balances: Balance[];
}

export class DebtSimplifier {
  /**
   * Computes the minimum number of payments to settle all debts in a group.
   * Handles cycles by reducing them to net flows.
   * Returns empty settlement plan when all balances are zero.
   */
  public simplifyDebts(group: DebtGroup): SettlementPlan {
    const balances = this.validateAndCopyBalances(group.balances);
    
    if (this.allBalancesZero(balances)) {
      return { payments: [] };
    }

    const payments: Payment[] = [];
    const activeBalances = balances.filter(b => Math.abs(b.amount) > 0.001);

    while (activeBalances.length > 1) {
      // Find the largest creditor and debtor
      const creditor = this.findLargestCreditor(activeBalances);
      const debtor = this.findLargestDebtor(activeBalances);

      if (!creditor || !debtor) {
        break;
      }

      // Calculate payment amount (minimum of creditor's credit and debtor's debt)
      const paymentAmount = Math.min(creditor.amount, Math.abs(debtor.amount));

      // Create payment
      payments.push({
        payer: debtor.memberId,
        payee: creditor.memberId,
        amount: Math.round(paymentAmount * 100) / 100 // Round to 2 decimal places
      });

      // Update balances
      creditor.amount -= paymentAmount;
      debtor.amount += paymentAmount;

      // Remove members with zero balance
      this.removeZeroBalances(activeBalances);
    }

    return { payments };
  }

  /**
   * Creates a single payment when exactly two members have non-zero balances.
   */
  public createDirectPayment(creditor: Balance, debtor: Balance): Payment {
    if (creditor.amount <= 0) {
      throw new Error('Creditor must have positive balance');
    }
    if (debtor.amount >= 0) {
      throw new Error('Debtor must have negative balance');
    }

    const paymentAmount = Math.min(creditor.amount, Math.abs(debtor.amount));
    
    return {
      payer: debtor.memberId,
      payee: creditor.memberId,
      amount: Math.round(paymentAmount * 100) / 100
    };
  }

  /**
   * Validates that the sum of all balances equals zero (conservation of money).
   */
  public validateBalances(balances: Balance[]): void {
    const total = balances.reduce((sum, balance) => sum + balance.amount, 0);
    
    if (Math.abs(total) > 0.001) {
      throw new Error(`Balances do not sum to zero. Total: ${total}`);
    }

    const memberIds = new Set<string>();
    for (const balance of balances) {
      if (memberIds.has(balance.memberId)) {
        throw new Error(`Duplicate member ID: ${balance.memberId}`);
      }
      memberIds.add(balance.memberId);
    }
  }

  /**
   * Verifies that the settlement plan produces the same net effect as individual debt payments.
   */
  public verifySettlement(originalBalances: Balance[], plan: SettlementPlan): boolean {
    const netEffects = new Map<string, number>();

    // Initialize with original balances
    for (const balance of originalBalances) {
      netEffects.set(balance.memberId, balance.amount);
    }

    // Apply payments
    for (const payment of plan.payments) {
      const payerBalance = netEffects.get(payment.payer) || 0;
      const payeeBalance = netEffects.get(payment.payee) || 0;

      netEffects.set(payment.payer, payerBalance - payment.amount);
      netEffects.set(payment.payee, payeeBalance + payment.amount);
    }

    // Check if all balances are zero (within tolerance)
    for (const [, balance] of netEffects) {
      if (Math.abs(balance) > 0.001) {
        return false;
      }
    }

    return true;
  }

  private validateAndCopyBalances(balances: Balance[]): Balance[] {
    this.validateBalances(balances);
    return balances.map(b => ({ ...b }));
  }

  private allBalancesZero(balances: Balance[]): boolean {
    return balances.every(b => Math.abs(b.amount) < 0.001);
  }

  private findLargestCreditor(balances: Balance[]): Balance | null {
    let largest: Balance | null = null;
    
    for (const balance of balances) {
      if (balance.amount > 0.001) {
        if (!largest || balance.amount > largest.amount) {
          largest = balance;
        }
      }
    }
    
    return largest;
  }

  private findLargestDebtor(balances: Balance[]): Balance | null {
    let largest: Balance | null = null;
    
    for (const balance of balances) {
      if (balance.amount < -0.001) {
        if (!largest || Math.abs(balance.amount) > Math.abs(largest.amount)) {
          largest = balance;
        }
      }
    }
    
    return largest;
  }

  private removeZeroBalances(balances: Balance[]): void {
    for (let i = balances.length - 1; i >= 0; i--) {
      if (Math.abs(balances[i].amount) < 0.001) {
        balances.splice(i, 1);
      }
    }
  }
}

export function simplifyDebts(group: DebtGroup): SettlementPlan {
  const simplifier = new DebtSimplifier();
  return simplifier.simplifyDebts(group);
}

export function createDirectPayment(creditor: Balance, debtor: Balance): Payment {
  const simplifier = new DebtSimplifier();
  return simplifier.createDirectPayment(creditor, debtor);
}

export function validateBalances(balances: Balance[]): void {
  const simplifier = new DebtSimplifier();
  simplifier.validateBalances(balances);
}

export function verifySettlement(originalBalances: Balance[], plan: SettlementPlan): boolean {
  const simplifier = new DebtSimplifier();
  return simplifier.verifySettlement(originalBalances, plan);
}

/** @internal Phoenix VCS traceability — do not remove. */
export const _phoenix = {
  iu_id: 'bd807bbd13956da99b7534dafef3fee0cc0996b3fb388afd9e398ada71532285',
  name: 'Debt Simplification',
  risk_tier: 'high',
  canon_ids: [6 as const],
} as const;