# The bench

Measures whether an application Phoenix produced **works** — and whether the pipeline is
why.

`phoenix selftest` asks *"does Phoenix still do what Phoenix claims?"*. It is a good
instrument, and it structurally cannot answer the question a sceptic asks first: how much
of the working application is the pipeline, and how much is a capable model being capable?
That question needs a control arm, one shared oracle, and enough samples to have an
interval. This is that.

```
phoenix bench --list                     # the vendored cases
phoenix bench --dry                      # what a run will cost, spends nothing
phoenix bench --res=coarse               # 5 samples on every arm
phoenix bench todo-api --arm=phoenix,baseline --res=fine
phoenix bench report                     # read the append-only results
phoenix bench report --html              # rebuild bench/site/index.html
```

## The three arms

The whole experiment is the difference between the rungs. The tooling is taken away in
two steps rather than one, because a rate with nothing to compare it to is unfalsifiable.

| Arm | What it is given | Calls |
|---|---|---|
| `phoenix` | The full pipeline as shipped, driven through the compiled CLI: `init` then `bootstrap` | whatever the pipeline spends internally |
| `baseline` | The same specification text, the same model, no pipeline | 1, no retry |
| `intent` | One sentence and the runtime contract. No requirement list, no routes | 1, no retry |

Every arm is told the **runtime contract** verbatim — entrypoint, `PORT`, `DB_PATH`, which
dependencies exist. That is the harness's requirement, not the pipeline's convention;
withholding it would measure "did the model guess our boot command".

The `phoenix` arm's internal retries are a real advantage and are **not corrected for**.
They are recorded on every entry as `budget`, printed under Disclosures, and stated on the
results page. "The pipeline minus its retry loop" is not a thing anyone can run.

## The oracle

One oracle for all three arms: boot the produced application for real, drive it over HTTP,
assert against the responses. It imports nothing from the pipeline and is not told which
arm produced the code.

Three outcomes, kept apart:

- **working** — every assertion held.
- **disagreed** — it booted, it answered, and it failed at least one assertion. The failed
  assertions are named in the record.
- **broke** — a phase died: nothing runnable was produced, or it never booted.

A fourth, **unreachable**, means the call never reached the model. It is excluded from
every denominator — an unreachable endpoint is not a producer that chose badly — and the
count is always printed beside the rate that excluded it.

## Reading a rate

`28/30 [0.78, 0.98]` is one number, not two. The bracket is a 95% Wilson score interval.
A perfect score at five samples is consistent with a true rate of 57%, which is why the
fraction never appears without the interval and the interval never replaces the fraction.

When two intervals overlap, the honest statement is **these runs do not distinguish these
rates** — never that they are equal, never that one arm is better. There are no p-values,
no significance tests and no league table in this harness.

## What a run must be before it can be cited

| Flag | Meaning |
|---|---|
| `smoke` | drawn at n≤2 to prove the plumbing works. Not a measurement. |
| `dirty` | uncommitted changes at run time, so the commit pins nothing. Not re-runnable. |
| `unstated` | no resolution was declared; its n was a default, not a decision. |

Flagged entries stay in the results and stay visible on the page — they are honest records
of what happened — and are excluded from every aggregate and every comparison.

Sample size is a property of the question:

| Resolution | n | The question |
|---|---|---|
| `smoke` | 2 | does the plumbing work at all? |
| `coarse` | 5 | differences that are enormous |
| `fine` | 30 | moving a rate that is already high |

`-n` below what the resolution calls for is refused. So is a dirty tree (`--dirty`
overrides it deliberately, and the entry records `clean: false` forever after), and so is
a missing `dist/cli.js` — the phoenix arm drives the compiled CLI, and a stale build is a
lie about which code was measured.

## Cases

A case is `bench/cases/<id>/`:

```
case.json     the architecture, the runtime contract, the one-sentence intent
spec/*.md     the specification — the phoenix and baseline arms both see this text
checks.json   the behavioural oracle, as data
```

Everything is vendored, so the commit pins the spec, the checks and Phoenix's own code —
everything except the model's sampling. The **fixture digest** is a hash over exactly those
files; two runs with different digests were not asked the same question and are never
pooled. Neither are two different models.

The checks are data rather than TypeScript on purpose: a check written in code could
import Phoenix, and an oracle that can see the generator is not an oracle.

## Results

Append-only JSONL under `bench/results/<case>.jsonl`, one object per run, never edited.
`bench/site/index.html` is generated from them and adds no measurement of its own.

## Cost

The bench spends real tokens and boots real servers. `--dry` prints the plan and the
estimate; the timeout is twice the estimate, because *slow* and *hung* are different
questions. Sample directories live in `.phoenix-bench/` (gitignored) and the most recent
20 are kept so a failure can be read afterwards.

---

The measurement discipline here — arms as a ladder, intervals over point estimates,
smoke/dirty runs shown but never counted, a vocabulary that refuses to print a number
that is constant by construction — is modelled on the
[Sedum eval harness](https://livecodelife.github.io/sedum/). See ACKNOWLEDGEMENTS in the
root README.
