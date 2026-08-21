# Should Phoenix be built on salsa (and therefore in Rust)?

**Status:** investigation, branch `investigate/salsa`. Not a decision, but it ends with a
recommendation and the conditions that would reverse it.
**Artifact:** a running spike under [`spike/salsa/`](../spike/salsa) — 16 tests, all green,
`cargo test` from that directory. Every claim below that can be tested, is.

---

## 0. Why this is even a question

[Salsa](https://github.com/salsa-rs/salsa) is the incremental computation framework behind
rust-analyzer. You declare *inputs* and *tracked functions*; it memoizes results, records the
dependency edges each function actually read, and on the next revision recomputes exactly the
functions whose inputs changed — with **backdating**, so a function that re-executes and
returns an equal value stops the cascade there.

That is, almost word for word, the PRD's defining capability:

> Changing one spec line invalidates only the dependent subtree — not the entire repository.

Phoenix implements that itself today, in about **1,055 lines** of `invalidation.ts`,
`cascade.ts`, `semhash.ts`, `warm-hasher.ts`, `iu-deps.ts`, `classifier.ts` and `d-rate.ts`,
plus three stores. Salsa implements the same shape as a general algorithm, tested by a
compiler used by hundreds of thousands of developers. The question is whether Phoenix should
stop maintaining its own.

---

## 1. What the spike shows

The spike models the real pipeline — `SpecDoc → clauses → canonicalize → plan → generate →
build` — with `canonicalize` and `generate` standing in for the two model calls. Every
simulated call is counted, because the model call is the only resource selective
invalidation exists to conserve. **No invalidation code is written anywhere in the spike.**

| Experiment | Model calls | What it demonstrates |
|---|---|---|
| Cold build (5 clauses, 2 units) | 5 canonicalize + 2 generate | the baseline bill |
| Ask again, unchanged | **0** | memoization |
| Reindent, change bullets, add a trailing full stop | **0** | Phoenix's A-class change, for free |
| Reorder two requirements in a section | **0** | backdating on a value-keyed unit |
| Change the meaning of one requirement | 1 canonicalize + **1** generate (of 2) | *selective invalidation, by construction* |
| Add a requirement to one section | 1 + 1 | the other unit is untouched |
| Delete a requirement | 0 + 1 | deletion is free on the way in |
| Same clause in a second document | **0** | content-addressed identity via interning |
| Bump the prompt pack | 0 canonicalize + 2 generate | *how* changed, *what* didn't |
| Restart the process (no persistence) | 7 — the whole bill | the CLI problem |
| Restart, restoring a serialized database | **0** | the CLI problem, solved |
| Edit after restoring | 1 + 1 | incrementality survives serialization |

Three of these deserve emphasis.

**The A-class change is not a heuristic here.** Phoenix classifies edits A/B/C/D using
semantic hashes and thresholds, and then measures its own uncertainty with a D-rate alarm.
In the spike a clause is an *interned* struct keyed by its normalised text, so a
formatting-only edit produces literally the same clause id, and nothing downstream is asked.
The classifier's easy case disappears into the data model. (Its hard cases do not — see §3.)

**Durability is pace layers.** Salsa's `Durability::HIGH` marks an input that rarely changes
so that low-durability edits skip validating anything that depends only on it. That is
PRINCIPLES §30 with a compiler enforcing it. The prompt-pack test shows the payoff Phoenix
argues for but cannot currently enforce: changing *how* code is generated does not re-derive
*what* is required.

**Persistence exists, and is new.** Salsa 0.28 (Aug 2026) ships an experimental
`persistence` feature — `#[salsa::input(persist)]`, `as_serialize`, `deserialize` — that
serializes the memo table, including dependency edges and revisions. Without it, salsa is a
non-starter for a CLI: `phoenix regen` would re-run every model call on every invocation,
which is the exact opposite of the point. With it, the spike restores a database from JSON
and rebuilds for zero calls, then takes an edit and pays for exactly the changed subtree.

### Rough edges found in the persistence prototype

- **Ingredients must be warmed before mutating a restored database.** Setting an input on a
  freshly deserialized database panics inside salsa —
  `tracked function ingredients cannot be accessed before calling init` — because a tracked
  function that has not run *in this process* has no view caster, and the revision bump walks
  into it. The workaround is one memo-hit call per tracked function after loading (see
  `a_restored_database_is_still_incremental`); it costs nothing but must be remembered, and it
  is the kind of thing that is a footgun in a product and a footnote in a spike.
- The serialized form is salsa's schema, not Phoenix's. It is inspectable JSON, but it
  explains nothing; it is a cache, not a record. See §3.

---

## 2. What Phoenix would get, concretely

| Phoenix does this by hand | Salsa gives it |
|---|---|
| `invalidation.ts` — walk clause → canon → IU → dependent IUs, mark stale | the dependency graph, recorded automatically from what each query actually read |
| `cascade.ts` — propagate staleness | red-green traversal |
| `semhash.ts` / `warm-hasher.ts` — content and context hashing for identity | interning (content identity) + backdating (value identity) |
| `iu-deps.ts` — derive IU→IU edges from generated imports | edges recorded at the moment one query calls another; nothing to derive |
| `classifier.ts` A-class | falls out of normalisation + interning |
| `canon-stability.ts` — is the canonical graph stable across runs? | revisions and `changed_at` per memo |
| "regenerate only the stale subtree" | the default behaviour of asking for a value |
| Pace layers, aspirationally | `Durability`, enforced |
| Parallel regeneration with a hand-rolled concurrency limit | salsa's parallel query execution with cancellation |

That is real: roughly a thousand lines of the most subtle code in the repository, replaced by
a library that a compiler team maintains, plus capabilities Phoenix does not have (parallel
revalidation, cancellation, LRU eviction of cold memos).

---

## 3. What salsa does **not** give — and this is the load-bearing part

### 3.1 Provenance is Phoenix's product; in salsa it is private plumbing

Salsa records the dependency edges — it must, to decide what to re-execute — and does not
expose them as a queryable artifact. There is no public API behind which `phoenix why
src/generated/task/task.ts` could be implemented, and the memoized graph is deliberately
allowed to forget (LRU eviction, cold memo reclamation) because it is a *cache*.

Phoenix's provenance is the opposite kind of object: append-only, hash-chained, verifiable
(`journal --verify`), and required to survive exactly the events salsa is entitled to forget.
In the spike, `GeneratedFile` carries `from_clauses` **by hand**, threaded through the return
values, and the test `provenance_has_to_be_threaded_by_hand` exists to make that explicit.

So a salsa-based Phoenix keeps its journal, and salsa's graph becomes a second, private,
non-authoritative dependency graph living beside the authoritative one. **Two representations
of the same causality is a smell**, and it is the same smell PRINCIPLES §29 warns about from
the other direction.

### 3.2 The cost model is inverted

Salsa is designed for microsecond-to-millisecond pure functions where recomputation is cheap
and the risk is doing too much of it. Phoenix's expensive query is a model call: seconds,
cents, rate limits, and — decisively — **not a function**. Same input, different output.

The spike's `a_nondeterministic_query_cascades_and_cannot_be_backdated` measures this: while
the memo holds, everything is fine; the moment a re-execution happens for any reason (a new
process without persistence, an evicted memo, a prompt-pack bump), the same requirement
yields different code, backdating fails, and the change cascades into everything downstream.
Salsa's contract is that queries are pure; Phoenix's central query is the one place in the
system that cannot be.

This is survivable — you make the memo authoritative and treat regeneration as the exception,
which is what Phoenix's content-addressed artifact store already does — but note what it
means: **the part of salsa Phoenix most needs (the graph) is the part it would use, and the
part salsa is built around (cheap pure recomputation) is the part Phoenix cannot supply.**

### 3.3 Half the system is not a computation

Selective invalidation is one PRD capability. The rest of Phoenix is: drift detection over a
working tree that humans edit, labelled waivers with expiry, evidence collection and
risk-tiered policy evaluation, the hash-chained journal, the trust dashboard and its
fault-injection meta-eval, bots, the inspector UI, the architecture-adequacy gate, the repair
loop, the live oracle that boots generated apps, and now the bench. **~29,500 lines of
TypeScript, of which the incremental machinery is ~1,050 (3.6%).** Salsa addresses the 3.6%.

### 3.4 An LLM-heavy codebase in Rust

Every generation path is prompt construction, JSON-ish parsing of model output, retry, and
repair. That is string-and-schema work where TypeScript's ecosystem (zod, the Anthropic and
OpenAI SDKs, `tsx` for the generated projects themselves) is a genuine advantage — and note
that the *generated* projects are TypeScript, so a Rust Phoenix still needs a Node toolchain
to compile and boot what it produces. The compile gate shells out to `tsc` either way.

---

## 4. The options

**A. Full rewrite in Rust on salsa.** Buys the graph and the performance; costs 29.5k lines
of working, tested, honestly-measured system, an ecosystem that fits the domain, and the
ability to ship anything else for months. The bench (which just found two real product bugs
in a week) would go quiet for the duration. **No.**

**B. Rust core + TypeScript shell.** A `phoenix-core` crate owning inputs → clauses →
canonical graph → IU plan → memo table, called over stdio/N-API; TypeScript keeps codegen,
gates, evidence, CLI, UI. Buys the graph without the rewrite; costs a language boundary
through the exact place the system is most iterated on right now, plus serialization of the
canonical graph across it on every call, plus two build toolchains. Defensible in a year,
premature today.

**C. Steal the algorithm, stay in TypeScript.** Adopt the three ideas the spike proves are
load-bearing, none of which need Rust:

1. **Content-identity for clauses and IUs** (interning): make identity *be* the normalised
   content hash, so A-class edits are free structurally rather than classified. Phoenix has
   `semhash.ts` and a two-layer identity already; the gap is that invalidation walks a
   separately-maintained graph instead of falling out of identity.
2. **Backdating**: after re-running a stage, compare the value to the previous memo and stop
   the cascade when equal. Phoenix re-canonicalizes and then invalidates dependents by graph
   walk; it does not systematically stop on "the output didn't change". This is the cheapest
   large win available, and it is maybe 50 lines.
3. **Durability/pace layers**: tag inputs (spec, prompt pack, architecture target, model id)
   with change frequency and skip validation of subtrees that depend only on slower layers.
   Phoenix has the *concept* in PRINCIPLES §30 and enforces it nowhere.

**D. Revisit when the shape changes.** Specifically when Phoenix becomes a long-running
process (a daemon or LSP-shaped server) rather than a CLI, since that is salsa's native
shape, and when the pipeline stops changing weekly.

---

## 5. Recommendation

**C now, D as the trigger for B.** Do not rewrite. Port the three ideas — identity-as-content,
backdating, durability — into the TypeScript pipeline, and keep this branch and its spike as
the record of why, and of what the ceiling looks like.

The honest summary of the investigation is that **salsa is a better implementation of
Phoenix's most-discussed capability and has nothing to say about the capability Phoenix is
actually selling.** Selective invalidation is table stakes that a library does better than
we do; provenance, evidence and the trust surface are the product, and they are the 96%.

### What would change this recommendation

- Phoenix grows a **daemon/server mode** (an editor integration, a hosted service, a watch
  loop). Salsa's in-memory model stops being a mismatch and becomes the point.
- The canonical graph gets big enough that **full re-derivation is the bottleneck**. Today the
  bottleneck is model latency by two orders of magnitude, so a faster graph engine buys
  nothing measurable. `phoenix bench` can settle this with numbers rather than intuition.
- Salsa's **persistence feature stabilises** (it is a prototype three PRs old; the
  warm-before-mutate panic in §1 is exactly the kind of edge that says "prototype").
- Someone builds the **provenance-export** layer — a way to read salsa's dependency edges as a
  first-class artifact. That single missing API is most of the reason the fit is partial.

---

## 6. Running the spike

```bash
cd spike/salsa
cargo test            # 16 tests: the table in §1
cargo test -- --nocapture
```

The spike is ~250 lines of pipeline and ~350 lines of tests. It contains no invalidation
logic, by design: everything in the table is salsa's behaviour, not the spike's.
