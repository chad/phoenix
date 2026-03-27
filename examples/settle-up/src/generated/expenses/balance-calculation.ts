export interface Expense {
  id: string;
  amount: number;
  paidBy: string;
  participants: string[];
  splitStrategy: 'equal' | 'exact' | 'percentage';
  splits?: Record<string, number>;
  description?: string;
  date: Date;
}

export interface Balance {
  memberId: string;
  amount: number;
}

export interface BalanceCalculationResult {
  balances: Balance[];
  totalExpenses: number;
  lastCalculated: Date;
}

export class BalanceCalculator {
  private expenses: Map<string, Expense> = new Map();
  private cachedResult: BalanceCalculationResult | null = null;
  private isDirty = false;

  addExpense(expense: Expense): void {
    this.expenses.set(expense.id, { ...expense });
    this.invalidateCache();
  }

  removeExpense(expenseId: string): boolean {
    const removed = this.expenses.delete(expenseId);
    if (removed) {
      this.invalidateCache();
    }
    return removed;
  }

  updateExpense(expense: Expense): void {
    if (this.expenses.has(expense.id)) {
      this.expenses.set(expense.id, { ...expense });
      this.invalidateCache();
    }
  }

  calculateBalances(): BalanceCalculationResult {
    if (this.cachedResult && !this.isDirty) {
      return this.cachedResult;
    }

    const memberBalances = new Map<string, number>();
    let totalExpenses = 0;

    // Process each expense
    for (const expense of this.expenses.values()) {
      totalExpenses += expense.amount;
      
      // Initialize balances for all participants and payer
      const allMembers = new Set([expense.paidBy, ...expense.participants]);
      for (const member of allMembers) {
        if (!memberBalances.has(member)) {
          memberBalances.set(member, 0);
        }
      }

      // Add the amount paid to the payer's balance
      const currentPaidBalance = memberBalances.get(expense.paidBy) || 0;
      memberBalances.set(expense.paidBy, currentPaidBalance + expense.amount);

      // Calculate and subtract each participant's share
      const shares = this.calculateShares(expense);
      for (const [memberId, share] of shares) {
        const currentBalance = memberBalances.get(memberId) || 0;
        memberBalances.set(memberId, currentBalance - share);
      }
    }

    // Convert to result format
    const balances: Balance[] = Array.from(memberBalances.entries())
      .map(([memberId, amount]) => ({
        memberId,
        amount: Math.round(amount * 100) / 100 // Round to 2 decimal places
      }))
      .sort((a, b) => a.memberId.localeCompare(b.memberId));

    this.cachedResult = {
      balances,
      totalExpenses: Math.round(totalExpenses * 100) / 100,
      lastCalculated: new Date()
    };

    this.isDirty = false;
    return this.cachedResult;
  }

  private calculateShares(expense: Expense): Map<string, number> {
    const shares = new Map<string, number>();

    switch (expense.splitStrategy) {
      case 'equal':
        const equalShare = expense.amount / expense.participants.length;
        for (const participant of expense.participants) {
          shares.set(participant, equalShare);
        }
        break;

      case 'exact':
        if (!expense.splits) {
          throw new Error(`Expense ${expense.id} uses exact split but has no splits defined`);
        }
        let exactTotal = 0;
        for (const participant of expense.participants) {
          const share = expense.splits[participant];
          if (share === undefined) {
            throw new Error(`Expense ${expense.id} missing exact split for participant ${participant}`);
          }
          shares.set(participant, share);
          exactTotal += share;
        }
        if (Math.abs(exactTotal - expense.amount) > 0.01) {
          throw new Error(`Expense ${expense.id} exact splits (${exactTotal}) don't match amount (${expense.amount})`);
        }
        break;

      case 'percentage':
        if (!expense.splits) {
          throw new Error(`Expense ${expense.id} uses percentage split but has no splits defined`);
        }
        let percentageTotal = 0;
        for (const participant of expense.participants) {
          const percentage = expense.splits[participant];
          if (percentage === undefined) {
            throw new Error(`Expense ${expense.id} missing percentage split for participant ${participant}`);
          }
          const share = (expense.amount * percentage) / 100;
          shares.set(participant, share);
          percentageTotal += percentage;
        }
        if (Math.abs(percentageTotal - 100) > 0.01) {
          throw new Error(`Expense ${expense.id} percentages don't sum to 100% (got ${percentageTotal}%)`);
        }
        break;

      default:
        throw new Error(`Unknown split strategy: ${expense.splitStrategy}`);
    }

    return shares;
  }

  private invalidateCache(): void {
    this.isDirty = true;
  }

  getExpenseCount(): number {
    return this.expenses.size;
  }

  hasExpense(expenseId: string): boolean {
    return this.expenses.has(expenseId);
  }

  clear(): void {
    this.expenses.clear();
    this.invalidateCache();
  }
}

export function createBalanceCalculator(): BalanceCalculator {
  return new BalanceCalculator();
}

export function calculateBalancesFromExpenses(expenses: Expense[]): BalanceCalculationResult {
  const calculator = createBalanceCalculator();
  
  for (const expense of expenses) {
    calculator.addExpense(expense);
  }
  
  return calculator.calculateBalances();
}

export function validateBalanceInvariants(result1: BalanceCalculationResult, result2: BalanceCalculationResult): boolean {
  if (result1.balances.length !== result2.balances.length) {
    return false;
  }

  if (Math.abs(result1.totalExpenses - result2.totalExpenses) > 0.01) {
    return false;
  }

  const balances1 = new Map(result1.balances.map(b => [b.memberId, b.amount]));
  const balances2 = new Map(result2.balances.map(b => [b.memberId, b.amount]));

  for (const [memberId, amount1] of balances1) {
    const amount2 = balances2.get(memberId);
    if (amount2 === undefined || Math.abs(amount1 - amount2) > 0.01) {
      return false;
    }
  }

  return true;
}

/** @internal Phoenix VCS traceability — do not remove. */
export const _phoenix = {
  iu_id: 'e443e41a77db31335cdc72e416297b42a40385bbfafcb1bff58c7a51688d6927',
  name: 'Balance Calculation',
  risk_tier: 'high',
  canon_ids: [3 as const],
} as const;