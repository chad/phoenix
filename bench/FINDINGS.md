# Bench findings

What the recorded runs actually said. Every claim here cites a run in
`bench/results/`; nothing is inferred from a run that was not drawn.

---

## 2026-08-20 · `todo-api` · fixture `9794771ec142f89a` · anthropic/claude-sonnet-5 · coarse (n=5)

| Arm | Works | Checks passed |
|---|---|---|
| `phoenix` | 0/5 [0.00, 0.43] | 25/120 [0.15, 0.29] |
| `baseline` | 5/5 [0.57, 1.00] | 120/120 [0.97, 1.00] |
| `intent` | 0/5 [0.00, 0.43] | 47/120 [0.31, 0.48] |

> These runs distinguish `phoenix` 0/5 [0.00, 0.43] from `baseline` 5/5 [0.57, 1.00]
> (intervals disjoint).

**The first thing the bench did was fail its owner.** The pipeline lost to a single call to
the same model, and passed fewer assertions than a one-sentence prompt. That is the number,
it stands, and the arms exist precisely so that it could be found.

### Why

Every `phoenix` sample failed identically, on the same first check. The specification's
"HTTP interface" section states the routes verbatim:

```
- `POST /tasks` — creates a task from a JSON body; returns 201 and the created task
- `GET /stats` — returns 200 and `{ "total": n, "completed": n, "completion_percent": n }`
```

The generated `src/server.ts` mounts:

```ts
mount('/task', task);
mount('/task-summary', task_summary);
```

The mount path is derived from the **implementation unit's name** (`routeSlug()` in
`src/live-verify.ts` and the scaffold's rule), not from what the spec says the interface
is. The IU planner named the unit `task`, so the API became `/task`. Nothing in the
pipeline reads the spec's stated interface, and nothing notices the contradiction: the
compile gate passes, the assembly gate passes, `phoenix status` is green. The service is
coherent, typechecks, boots, and is not the service the spec describes.

This is a **conservation-layer failure** in the project's own vocabulary: the interface is
the durable asset, and the pipeline treated it as an implementation detail derived from an
internal name. It is also exactly the class of bug that `phoenix selftest` cannot catch,
because every capability it asserts is about Phoenix's internals and none of them is
"the app answers on the URL the spec named".

### The other honest reading of the same number

`baseline` at 5/5 is a to-do CRUD API with validation and a summary — squarely the shape a
frontier model has seen ten thousand times, in one call, with no retries needed. This case
does not yet ask Phoenix a question a strong model finds hard. A case whose spec is large
enough that one call cannot hold it, or whose requirements change after generation (where
selective invalidation is the whole point), would ask a different question. Building those
cases is the backlog, and stating that here is not a hedge against the number above — the
number above is about *this* case, and on this case the pipeline lost.

### False passes worth naming

`phoenix`'s five passing checks were: `health answers 200`, and four 404 expectations
(`reading a missing task is 404`, `updating a missing task is 404`, `a deleted task is
gone`, `deleting a missing task is 404`). They passed because **nothing was mounted at
`/tasks`, so every request 404s**. An assertion that a missing thing is missing is
satisfied by a service that has nothing at all.

The oracle is not wrong to count them — they were the assertions that were made — but any
case whose checks are mostly negative can flatter an empty app. The mitigation is in the
case, not the harness: keep positive assertions in the majority, and read `checks passed`
next to `works` rather than instead of it.

---

## 2026-08-21 · both cases · phoenix `14dd469` · claude-sonnet-5 · coarse (n=5)

The run after the interface fix, and the first run of the harder case.

| Case | Arm | Works | Checks passed |
|---|---|---|---|
| `todo-api` | `phoenix` | 0/5 [0.00, 0.43] | **70/120 [0.49, 0.67]** (was 25/120 at `db405ca`) |
| `todo-api` | `baseline` | 5/5 [0.57, 1.00] | 120/120 [0.97, 1.00] |
| `todo-api` | `intent` | 0/5 [0.00, 0.43] | 49/120 [0.32, 0.50] |
| `library-api` | `phoenix` | 0/5 [0.00, 0.43] | 66/204 [0.26, 0.39] (4 disagreed, 1 broke) |
| `library-api` | `baseline` | 5/5 [0.57, 1.00] | 255/255 [0.99, 1.00] |
| `library-api` | `intent` | 0/5 [0.00, 0.43] | 88/255 [0.29, 0.41] |

**The interface fix moved the number it was supposed to move**: `todo-api`'s check rate went
from 25/120 [0.15, 0.29] to 70/120 [0.49, 0.67] with the fixture unchanged — disjoint intervals,
and the only thing that changed was the commit. That is what per-commit pooling is for.

**It did not move the rate anybody cares about.** `works` is still 0/5, because `works` requires
*every* assertion, and each case now fails on something else:

- `todo-api`, 5/5 samples: the spec says priority is one of *urgent, high, normal, low*; the
  generated enum is `['high','normal','low']`. A member of a declared set was dropped somewhere
  between canonicalization and codegen, so `POST /tasks {"priority":"urgent"}` is rejected as
  invalid. Four checks fall with it, three by cascade (the rejected create leaves the `{second}`
  binding unsaved).
- `library-api`, 4/5 samples: the book resource is wrong from its first request onward.
  1/5 samples never booted at all — `SqliteError: near "when": syntax error`, generated DDL that
  SQLite will not parse, which the compile gate cannot see because it is a *string*.

**The baseline one-shots both cases.** 255/255 checks on a 51-check, three-entity spec with
derived availability counts, a borrowing limit and 409-vs-400 semantics. That is the honest
context for every number above: at this size, a frontier model does not need a pipeline, so
these cases cannot show pipeline value even in principle — they can only show pipeline *damage*,
which they are currently doing. A case that could show value has to be one a single call cannot
hold, or has to measure the thing the pipeline is actually for: what happens on the *second*
spec, when one line changes.

---

## 2026-08-20 · fixture `9fc6564bd1448cda` (superseded)

The first coarse run, drawn before the runtime contract stated the health route. Its
`intent` arm reads 0/5 broke; that was a scoring artifact and the reason for the digest
change. See `cases/todo-api/CHANGELOG.md`. The entries stay in the results and are never
pooled with the runs above.
