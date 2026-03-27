export interface Member {
  id: string;
  name: string;
}

export interface Expense {
  id: string;
  amount: number;
  description: string;
  paidBy: string;
  splitAmong: string[];
  date: Date;
}

export interface MemberBalance {
  memberId: string;
  memberName: string;
  netBalance: number;
}

export interface GroupSummary {
  memberBalances: MemberBalance[];
  totalExpenses: number;
  totalAmountSpent: number;
}

export class GroupSummaryCalculator {
  calculateGroupSummary(members: Member[], expenses: Expense[]): GroupSummary {
    const memberBalances = this.calculateMemberBalances(members, expenses);
    const totalExpenses = expenses.length;
    const totalAmountSpent = expenses.reduce((sum, expense) => sum + expense.amount, 0);

    // Validate invariant: net balances sum to zero
    const balanceSum = memberBalances.reduce((sum, balance) => sum + balance.netBalance, 0);
    if (Math.abs(balanceSum) > 0.01) { // Allow for floating point precision
      throw new Error(`Balance invariant violated: net balances sum to ${balanceSum}, expected 0`);
    }

    return {
      memberBalances,
      totalExpenses,
      totalAmountSpent
    };
  }

  private calculateMemberBalances(members: Member[], expenses: Expense[]): MemberBalance[] {
    const balances = new Map<string, number>();
    
    // Initialize all member balances to zero
    members.forEach(member => {
      balances.set(member.id, 0);
    });

    // Calculate balances from expenses
    expenses.forEach(expense => {
      const paidBy = expense.paidBy;
      const splitAmong = expense.splitAmong;
      const sharePerMember = expense.amount / splitAmong.length;

      // Add the full amount to the person who paid
      const currentPaidBalance = balances.get(paidBy) || 0;
      balances.set(paidBy, currentPaidBalance + expense.amount);

      // Subtract each person's share
      splitAmong.forEach(memberId => {
        const currentBalance = balances.get(memberId) || 0;
        balances.set(memberId, currentBalance - sharePerMember);
      });
    });

    // Convert to MemberBalance array
    return members.map(member => ({
      memberId: member.id,
      memberName: member.name,
      netBalance: Math.round((balances.get(member.id) || 0) * 100) / 100 // Round to 2 decimal places
    }));
  }
}

export function createGroupSummary(members: Member[], expenses: Expense[]): GroupSummary {
  const calculator = new GroupSummaryCalculator();
  return calculator.calculateGroupSummary(members, expenses);
}

export function formatBalance(balance: number): string {
  if (balance > 0) {
    return `+$${balance.toFixed(2)}`;
  } else if (balance < 0) {
    return `-$${Math.abs(balance).toFixed(2)}`;
  } else {
    return '$0.00';
  }
}

export function getBalanceDescription(balance: number): string {
  if (balance > 0) {
    return 'is owed';
  } else if (balance < 0) {
    return 'owes';
  } else {
    return 'is settled';
  }
}

/** @internal Phoenix VCS traceability — do not remove. */
export const _phoenix = {
  iu_id: 'a02fd56f33699fed19c79270509ac1218dc35d1bdd5d205a5e7d5fe40a92a0d5',
  name: 'Group Summary',
  risk_tier: 'high',
  canon_ids: [3 as const],
} as const;