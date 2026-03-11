# Expenses

## Creating an Expense

- An expense must have a unique expense ID, a description, an amount, and a date
- An expense must reference exactly one payer (who paid) by member ID
- An expense must reference one or more participants (who benefited) by member ID
- The payer must be a member of the group
- All participants must be members of the group
- The expense amount must be a positive number with at most two decimal places
- An expense cannot be created in a group that does not exist

## Split Strategies

- An expense can be split equally among all participants
- An expense can be split by exact amounts specified per participant
- An expense can be split by percentages that must sum to 100
- When splitting equally, remainders (e.g. $10 / 3) must be assigned to the payer — no rounding loss
- The sum of all individual shares must always equal the total expense amount — this is a system invariant

## Expense History

- All expenses in a group must be queryable in reverse chronological order
- Expenses must be filterable by payer, by participant, and by date range
- Each expense must record who created it and when
- An expense can be deleted by the member who created it
- Deleting an expense must reverse its effect on all member balances immediately


## Balance Calculation

- Each member's balance must be computed from the full expense history
- A member's balance is: (total they paid for others) minus (total others paid for them)
- Balance calculation must be deterministic — same expenses always produce same balances
- Balances must be recalculated whenever an expense is added or deleted
