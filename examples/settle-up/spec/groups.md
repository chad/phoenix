# Groups

## Group Management

- A group must have a unique group ID, a name, and a currency code (e.g. "USD", "EUR")
- A group must have at least one member
- A group must track its creation date
- Only group members can add expenses to the group
- A member can belong to multiple groups
- Each member must have a unique member ID, a display name, and an email address

## Member Operations

- A member can be added to a group by any existing member
- A member can leave a group only if their net balance is zero
- When a member leaves, their past expenses remain in the group history
- A member cannot be removed from a group if they owe or are owed money

## Group Summary

- The group summary must show each member's net balance (positive = owed, negative = owes)
- The group summary must show the total number of expenses and total amount spent
- Net balances across all members must always sum to zero — this is a system invariant
