# Settlements

## Debt Simplification

- The system must compute the minimum number of payments to settle all debts in a group
- A settlement plan must list each required payment: who pays whom, and how much
- A simplified settlement must produce the same net effect as paying each debt individually
- If only two members have a balance, the settlement is a single payment from debtor to creditor
- The algorithm must handle cycles (A owes B, B owes C, C owes A) by reducing to net flows
- A group where all balances are zero must produce an empty settlement plan

## Recording Settlements

- A member can record a settlement payment (I paid X to Y for Z amount)
- Recording a settlement must update both members' balances
- A settlement must be rejected if the amount exceeds what the payer owes the recipient
- Settlements must be tracked separately from expenses in the history
- A settlement has: settlement ID, payer, recipient, amount, date, and optional note

## Settlement Status

- The system must report whether a group is "settled up" (all balances zero) or has outstanding debts
- Each member must be able to see: who they owe, who owes them, and the amounts
- The total of all outstanding debts must be visible at the group level
