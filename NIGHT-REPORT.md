# NIGHT-REPORT — No false green survived the night

**Branch:** `feat/close-last-red` · **Started from:** `feat/close-trust-loops`
**Goal:** [NIGHT-GOAL.md](./NIGHT-GOAL.md) — close Phoenix's last red (cross-entity /
relational + executable invariant checking) and *prove* the trust surface stays
honest under adversarial fault injection.

## Headline

`phoenix status` went from **silent on a real financial bug** to **catching it,
precisely attributing it, and confirming the fix** — and along the way it exposed
and killed a genuine false-green in its own oracle. Every hard gate held.

| Metric | Before | After |
| --- | --- | --- |
| selftest green-health | 100% (23/23) | **100% (26/26)** |
| selftest overall | 96% (23/24) | 96% (26/27) |
| Known reds | 1 (advanced-kinds bundle) | 1 (honest executable-aggregate tail) |
| Assertion kinds implemented | 4 (bound/membership/pattern/uniqueness) | **7 (+ reference/cardinality/expr)** |
| Full test suite | 742 green | **751 green** (0 regressions) |
| Constraint false-green rate | 1 latent (found + killed) | **0** (gated) |
| `--strict` | clean | clean |

## The magical proof — the Ledger overdraft

The spec says (spec/ledger.md, *Balances*): *"An account balance must never be
negative … reject a cleared debit that would take an account balance below zero."*
`balance.ts` guards this; `transaction.ts` — a **second write path** — did not.

```
BEFORE the capability   status: (silent — no constraint diagnostic for the overdraft)

AFTER the capability     ✖ constraint · transaction.invariant
                           write path "transaction" does not enforce this invariant
                           (no 0-floor guard protects "balance" against going below 0)
                           → Add a guard in transaction so no write path can reach a
                             state the invariant forbids, then regenerate

AFTER the one-line fix   status: (invariant conforms — GREEN)
```

`balance.ts`, which *does* guard, was correctly **not** flagged. The trust loop
closed end-to-end: caught → fixed → confirmed. (The fix was applied to `~/ledger`'s
`transaction.ts`; it is a real overdraft guard, not a demo stub.)

## What shipped (one commit per capability)

1. **`ae77db5` — Reference, Cardinality & Expr kinds.** Extends the SHACL-spine
   algebra with the relational tail. Reference (FK / existence guard), Cardinality
   (non-empty / count guard), and Expr — relational/conditional invariants routed to
   the executable oracle (`checkProperty`), which **catches** a missing guard on
   reducible shapes and **abstains** otherwise (never false-greens). Old advanced-kinds
   red retired into 3 green cases; one honest new red remains.
2. **`77d6de4` — Write-path-aware Expr + a killed false-green.** A state invariant can
   be broken by *any* module that writes the governed rows. Using the Membership
   value→entity map (`"debit"` → transaction), status now checks the invariant against
   **every** write path and names the culprit. This exposed a real false-green:
   `checkProperty` was reading a stray `conditions.length > 0` as a balance guard. Fixed
   — the 0-floor guard must now be **co-located** with the constrained quantity.
3. **`8184e82` — Constraint fault-injection meta-eval.** A deterministic corpus over
   all 7 kinds: conforming / faulted / false-green-trap code with known ground truth.
   Gates **false-green = 0**, recall = 100%, false-red = 0. Locks the `> 0` trap as a
   permanent regression guard.

## The corpus (constraint fault-injection)

| kind | conforming → | faulted → | false-green trap → |
| --- | --- | --- | --- |
| bound | conforms | absent | `.max(100)` (wrong value) → caught |
| membership | conforms | absent | wrong value-set → caught |
| pattern | conforms | absent | `.email()` on wrong field → caught |
| uniqueness | conforms | absent | `UNIQUE` on wrong column → caught |
| reference | conforms | absent | reads, never verifies existence → caught |
| cardinality | conforms | absent | `.max(1)` posing as ≥1 floor → caught |
| expr | conforms | violates | stray `length > 0` as balance guard → caught |

**recall 100% · false-green 0 · false-red 0.** Plus the existing status
fault-injection meta-eval (drift / missing / boundary / stale) still at 100%/100%.

## Honest ledger — what is still red

**`constraint.executable-aggregate-invariants-not-yet-proven`** (1 known red). Expr
invariants are now caught when statically reducible (sign / threshold / bound / enum /
non-empty) and abstained otherwise. The genuinely-hard tail remains open: cross-entity
**aggregate equalities** ("a dashboard total equals the sum of all account balances")
and **temporal** invariants ("archived 90 days after…") cannot be *proven* by static
reduction — a correct implementation is honestly abstained (INCOMPLETE), never
false-greened. Fix path: a real executable, mutation-gated property-eval runner (the
same gate `trust.behavioral-ok-is-withheld` is waiting on). The eval doubles as the
roadmap.

## Newly discovered (worth a look)

- **A real false-green in `checkProperty`** (the `> 0` trap) — found by the write-path
  work, fixed, and locked. This is the single most important line of the night: a
  false green erodes the trust surface as surely as anything, and it was live.
- **Ledger has two transaction write paths** (`transaction.ts` and `balance.ts`) with
  inconsistent guarding — the kind of drift the write-path check is built to catch.

## How to verify

```bash
npm test                      # 751 green
npm run phoenix -- selftest   # green-health 100%, 1 honest red
npm run phoenix -- selftest --strict   # clean
cd ~/ledger && node ~/src/phoenix/dist/cli.js status   # overdraft now enforced
```
