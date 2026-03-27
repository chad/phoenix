export interface DebtInfo {
  creditorId: string;
  debtorId: string;
  amount: number;
}

export interface MemberStatus {
  memberId: string;
  owesTo: Array<{ memberId: string; amount: number }>;
  owedBy: Array<{ memberId: string; amount: number }>;
  netBalance: number;
}

export interface GroupSettlementStatus {
  isSettled: boolean;
  totalOutstandingDebt: number;
  memberStatuses: MemberStatus[];
}

export class SettlementStatusTracker {
  private debts: Map<string, DebtInfo[]> = new Map();

  addDebt(creditorId: string, debtorId: string, amount: number): void {
    if (amount <= 0) {
      throw new Error('Debt amount must be positive');
    }
    if (creditorId === debtorId) {
      throw new Error('Creditor and debtor cannot be the same person');
    }

    const key = `${creditorId}-${debtorId}`;
    const existingDebts = this.debts.get(key) || [];
    existingDebts.push({ creditorId, debtorId, amount });
    this.debts.set(key, existingDebts);
  }

  removeDebt(creditorId: string, debtorId: string, amount: number): void {
    const key = `${creditorId}-${debtorId}`;
    const existingDebts = this.debts.get(key) || [];
    
    let remainingAmount = amount;
    const updatedDebts = existingDebts.filter(debt => {
      if (remainingAmount <= 0) return true;
      if (debt.amount <= remainingAmount) {
        remainingAmount -= debt.amount;
        return false;
      } else {
        debt.amount -= remainingAmount;
        remainingAmount = 0;
        return true;
      }
    });

    if (updatedDebts.length === 0) {
      this.debts.delete(key);
    } else {
      this.debts.set(key, updatedDebts);
    }
  }

  getNetBalances(memberIds: string[]): Map<string, number> {
    const balances = new Map<string, number>();
    
    // Initialize all members with zero balance
    memberIds.forEach(id => balances.set(id, 0));

    // Calculate net balances from all debts
    for (const debts of this.debts.values()) {
      for (const debt of debts) {
        const creditorBalance = balances.get(debt.creditorId) || 0;
        const debtorBalance = balances.get(debt.debtorId) || 0;
        
        balances.set(debt.creditorId, creditorBalance + debt.amount);
        balances.set(debt.debtorId, debtorBalance - debt.amount);
      }
    }

    return balances;
  }

  getMemberStatus(memberId: string, allMemberIds: string[]): MemberStatus {
    const netBalances = this.getNetBalances(allMemberIds);
    const owesTo: Array<{ memberId: string; amount: number }> = [];
    const owedBy: Array<{ memberId: string; amount: number }> = [];

    // Calculate what this member owes to others
    for (const [key, debts] of this.debts.entries()) {
      for (const debt of debts) {
        if (debt.debtorId === memberId) {
          const existing = owesTo.find(item => item.memberId === debt.creditorId);
          if (existing) {
            existing.amount += debt.amount;
          } else {
            owesTo.push({ memberId: debt.creditorId, amount: debt.amount });
          }
        }
        if (debt.creditorId === memberId) {
          const existing = owedBy.find(item => item.memberId === debt.debtorId);
          if (existing) {
            existing.amount += debt.amount;
          } else {
            owedBy.push({ memberId: debt.debtorId, amount: debt.amount });
          }
        }
      }
    }

    return {
      memberId,
      owesTo: owesTo.sort((a, b) => b.amount - a.amount),
      owedBy: owedBy.sort((a, b) => b.amount - a.amount),
      netBalance: netBalances.get(memberId) || 0
    };
  }

  getGroupStatus(memberIds: string[]): GroupSettlementStatus {
    const netBalances = this.getNetBalances(memberIds);
    const memberStatuses = memberIds.map(id => this.getMemberStatus(id, memberIds));
    
    // Calculate total outstanding debt (sum of all positive balances)
    let totalOutstandingDebt = 0;
    for (const balance of netBalances.values()) {
      if (balance > 0) {
        totalOutstandingDebt += balance;
      }
    }

    // Group is settled if all balances are zero (within floating point precision)
    const isSettled = Array.from(netBalances.values()).every(balance => 
      Math.abs(balance) < 0.01
    );

    return {
      isSettled,
      totalOutstandingDebt: Math.round(totalOutstandingDebt * 100) / 100,
      memberStatuses
    };
  }

  clearAllDebts(): void {
    this.debts.clear();
  }

  getAllDebts(): DebtInfo[] {
    const allDebts: DebtInfo[] = [];
    for (const debts of this.debts.values()) {
      allDebts.push(...debts);
    }
    return allDebts;
  }
}

export function createSettlementTracker(): SettlementStatusTracker {
  return new SettlementStatusTracker();
}

export function formatDebtSummary(memberStatus: MemberStatus): string {
  const lines: string[] = [];
  
  if (memberStatus.owesTo.length > 0) {
    lines.push('You owe:');
    memberStatus.owesTo.forEach(debt => {
      lines.push(`  ${debt.memberId}: $${debt.amount.toFixed(2)}`);
    });
  }

  if (memberStatus.owedBy.length > 0) {
    if (lines.length > 0) lines.push('');
    lines.push('You are owed by:');
    memberStatus.owedBy.forEach(debt => {
      lines.push(`  ${debt.memberId}: $${debt.amount.toFixed(2)}`);
    });
  }

  if (lines.length === 0) {
    lines.push('No outstanding debts');
  }

  return lines.join('\n');
}

/** @internal Phoenix VCS traceability — do not remove. */
export const _phoenix = {
  iu_id: '7b08497eefb99ff90fbe8cdf1377b42c64fbe480776ace6cd60b6a03296c3bee',
  name: 'Settlement Status',
  risk_tier: 'low',
  canon_ids: [3 as const],
} as const;