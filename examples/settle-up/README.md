# Settle Up — Phoenix Example

An expense-splitting app (like Splitwise) specified across four specs:
groups, expenses, settlements, and REST API.

**Why this example?** It's simple enough that anyone understands it instantly —
you split a dinner bill with friends. But it has real architectural complexity:
money math with invariants (balances must sum to zero), a graph optimization
problem (minimum settlements), multiple risk tiers (balance calculation is
critical, API formatting is low), and conservation layers (the API shape
is a public contract that can't change freely).

## Walkthrough

```bash
# From the phoenix repo root (one-time)
cd /path/to/phoenix
npm run build && npm link

# Enter this example
cd examples/settle-up

# Step 1: Initialize Phoenix
phoenix init

# Step 2: Bootstrap — ingest specs, canonicalize, plan, generate
phoenix bootstrap

# Step 3: Explore what was produced
phoenix status        # Trust dashboard
phoenix canon         # Canonical requirement graph
phoenix plan          # Implementation Units
phoenix drift         # Drift detection
phoenix evaluate      # Evidence against policy
phoenix audit         # Replacement readiness per IU

# Step 4: Make a change — edit a spec, see what cascades
# e.g. add "expenses must support tags" to spec/expenses.md
phoenix diff          # See what changed
phoenix bootstrap     # Re-run pipeline

# Step 5: Install and test
npm install
npm test
npm start             # API server on :3000
```

## Specs

| Spec | Covers |
|------|--------|
| `spec/groups.md` | Group lifecycle, membership, balances summing to zero |
| `spec/expenses.md` | Expense creation, split strategies, remainder handling, balance math |
| `spec/settlements.md` | Debt simplification algorithm, settlement recording, settled-up status |
| `spec/api.md` | REST endpoints, error codes, response envelope, pagination |

## Interesting Things to Notice

1. **Risk tiers vary**: Balance calculation is `critical` (money math). API formatting is `low`. Phoenix assigns different evidence requirements.
2. **Invariants are real**: "Net balances must sum to zero" is a system invariant that evaluation coverage will flag if untested.
3. **The settlement algorithm is a graph problem**: Minimum payments to settle all debts is a max-flow / net-flow optimization. Canonical extraction should identify this as a distinct requirement.
4. **The API is a conservation layer**: External clients depend on the response format. `phoenix audit` should flag it as needing conservation-layer protection.
5. **Remainder handling is subtle**: $10 split 3 ways can't be $3.33 × 3. The spec says the payer absorbs the extra cent. This is the kind of constraint that negative knowledge captures when a generation attempt gets it wrong.
