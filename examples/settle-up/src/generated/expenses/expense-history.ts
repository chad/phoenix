export interface Expense {
  id: string;
  groupId: string;
  description: string;
  amount: number;
  payerId: string;
  participantIds: string[];
  splitStrategy: 'equal' | 'exact' | 'percentage';
  splitDetails?: Record<string, number>;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ExpenseFilter {
  payerId?: string;
  participantId?: string;
  startDate?: Date;
  endDate?: Date;
}

export interface ExpenseHistoryEntry {
  expense: Expense;
  balanceChanges: Record<string, number>;
}

export class ExpenseHistory {
  private expenses = new Map<string, Expense>();
  private groupExpenses = new Map<string, Set<string>>();
  private balanceChanges = new Map<string, Record<string, number>>();

  addExpense(expense: Expense, balanceChanges: Record<string, number>): void {
    if (!expense.id || !expense.groupId) {
      throw new Error('Expense must have valid id and groupId');
    }

    this.expenses.set(expense.id, { ...expense });
    this.balanceChanges.set(expense.id, { ...balanceChanges });

    if (!this.groupExpenses.has(expense.groupId)) {
      this.groupExpenses.set(expense.groupId, new Set());
    }
    this.groupExpenses.get(expense.groupId)!.add(expense.id);
  }

  getExpenseHistory(groupId: string, filter?: ExpenseFilter): ExpenseHistoryEntry[] {
    const expenseIds = this.groupExpenses.get(groupId) || new Set();
    const expenses: ExpenseHistoryEntry[] = [];

    for (const expenseId of expenseIds) {
      const expense = this.expenses.get(expenseId);
      const balanceChanges = this.balanceChanges.get(expenseId);

      if (!expense || !balanceChanges) continue;

      if (this.matchesFilter(expense, filter)) {
        expenses.push({
          expense: { ...expense },
          balanceChanges: { ...balanceChanges }
        });
      }
    }

    return expenses.sort((a, b) => b.expense.createdAt.getTime() - a.expense.createdAt.getTime());
  }

  deleteExpense(expenseId: string): { expense: Expense; reversalChanges: Record<string, number> } | null {
    const expense = this.expenses.get(expenseId);
    const originalChanges = this.balanceChanges.get(expenseId);

    if (!expense || !originalChanges) {
      return null;
    }

    // Remove from storage
    this.expenses.delete(expenseId);
    this.balanceChanges.delete(expenseId);

    // Remove from group index
    const groupExpenses = this.groupExpenses.get(expense.groupId);
    if (groupExpenses) {
      groupExpenses.delete(expenseId);
      if (groupExpenses.size === 0) {
        this.groupExpenses.delete(expense.groupId);
      }
    }

    // Calculate reversal changes (opposite of original)
    const reversalChanges: Record<string, number> = {};
    for (const [memberId, change] of Object.entries(originalChanges)) {
      reversalChanges[memberId] = -change;
    }

    return {
      expense: { ...expense },
      reversalChanges
    };
  }

  getExpenseById(expenseId: string): Expense | null {
    const expense = this.expenses.get(expenseId);
    return expense ? { ...expense } : null;
  }

  getExpensesByPayer(groupId: string, payerId: string): ExpenseHistoryEntry[] {
    return this.getExpenseHistory(groupId, { payerId });
  }

  getExpensesByParticipant(groupId: string, participantId: string): ExpenseHistoryEntry[] {
    return this.getExpenseHistory(groupId, { participantId });
  }

  getExpensesByDateRange(groupId: string, startDate: Date, endDate: Date): ExpenseHistoryEntry[] {
    return this.getExpenseHistory(groupId, { startDate, endDate });
  }

  private matchesFilter(expense: Expense, filter?: ExpenseFilter): boolean {
    if (!filter) return true;

    if (filter.payerId && expense.payerId !== filter.payerId) {
      return false;
    }

    if (filter.participantId && !expense.participantIds.includes(filter.participantId)) {
      return false;
    }

    if (filter.startDate && expense.createdAt < filter.startDate) {
      return false;
    }

    if (filter.endDate && expense.createdAt > filter.endDate) {
      return false;
    }

    return true;
  }

  getAllExpenses(groupId: string): Expense[] {
    const expenseIds = this.groupExpenses.get(groupId) || new Set();
    const expenses: Expense[] = [];

    for (const expenseId of expenseIds) {
      const expense = this.expenses.get(expenseId);
      if (expense) {
        expenses.push({ ...expense });
      }
    }

    return expenses.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  getExpenseCount(groupId: string): number {
    return this.groupExpenses.get(groupId)?.size || 0;
  }
}

/** @internal Phoenix VCS traceability — do not remove. */
export const _phoenix = {
  iu_id: '45d7e97e8e17b3b07632284b5d7580f5858cbc9a256ace230c192c73f8587c12',
  name: 'Expense History',
  risk_tier: 'medium',
  canon_ids: [4 as const],
} as const;