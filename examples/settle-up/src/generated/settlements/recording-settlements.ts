export interface Member {
  id: string;
  name: string;
  balance: number;
}

export interface Settlement {
  id: string;
  payerId: string;
  recipientId: string;
  amount: number;
  timestamp: Date;
  description?: string;
}

export interface HistoryEntry {
  id: string;
  type: 'settlement' | 'expense';
  timestamp: Date;
  data: Settlement | any;
}

export class SettlementRecorder {
  private members: Map<string, Member> = new Map();
  private settlements: Map<string, Settlement> = new Map();
  private history: HistoryEntry[] = [];

  addMember(member: Member): void {
    this.members.set(member.id, { ...member });
  }

  getMember(id: string): Member | undefined {
    const member = this.members.get(id);
    return member ? { ...member } : undefined;
  }

  getDebtAmount(payerId: string, recipientId: string): number {
    const payer = this.members.get(payerId);
    const recipient = this.members.get(recipientId);
    
    if (!payer || !recipient) {
      return 0;
    }

    // If payer has negative balance and recipient has positive balance,
    // the debt is the minimum of absolute values
    if (payer.balance < 0 && recipient.balance > 0) {
      return Math.min(Math.abs(payer.balance), recipient.balance);
    }

    return 0;
  }

  recordSettlement(
    payerId: string,
    recipientId: string,
    amount: number,
    description?: string
  ): Settlement {
    if (amount <= 0) {
      throw new Error('Settlement amount must be positive');
    }

    const payer = this.members.get(payerId);
    const recipient = this.members.get(recipientId);

    if (!payer) {
      throw new Error(`Payer with id ${payerId} not found`);
    }

    if (!recipient) {
      throw new Error(`Recipient with id ${recipientId} not found`);
    }

    if (payerId === recipientId) {
      throw new Error('Payer and recipient cannot be the same person');
    }

    const debtAmount = this.getDebtAmount(payerId, recipientId);
    
    if (amount > debtAmount) {
      throw new Error(
        `Settlement amount ${amount} exceeds the amount the payer owes the recipient (${debtAmount})`
      );
    }

    const settlement: Settlement = {
      id: this.generateId(),
      payerId,
      recipientId,
      amount,
      timestamp: new Date(),
      description,
    };

    // Update balances
    payer.balance += amount;
    recipient.balance -= amount;

    // Store settlement
    this.settlements.set(settlement.id, settlement);

    // Add to history
    const historyEntry: HistoryEntry = {
      id: this.generateId(),
      type: 'settlement',
      timestamp: settlement.timestamp,
      data: settlement,
    };

    this.history.push(historyEntry);

    return { ...settlement };
  }

  getSettlement(id: string): Settlement | undefined {
    const settlement = this.settlements.get(id);
    return settlement ? { ...settlement } : undefined;
  }

  getAllSettlements(): Settlement[] {
    return Array.from(this.settlements.values()).map(s => ({ ...s }));
  }

  getHistory(): HistoryEntry[] {
    return this.history.map(entry => ({
      ...entry,
      data: { ...entry.data },
    }));
  }

  getSettlementHistory(): Settlement[] {
    return this.history
      .filter(entry => entry.type === 'settlement')
      .map(entry => ({ ...entry.data as Settlement }));
  }

  private generateId(): string {
    return Math.random().toString(36).substring(2) + Date.now().toString(36);
  }
}

export function createSettlementRecorder(): SettlementRecorder {
  return new SettlementRecorder();
}

/** @internal Phoenix VCS traceability — do not remove. */
export const _phoenix = {
  iu_id: 'b1fdf8ff8565aee6f30792cf338f9a51981dd9d42d62ed9054a341ee6a1bb348',
  name: 'Recording Settlements',
  risk_tier: 'low',
  canon_ids: [3 as const],
} as const;