# Phoenix Canonicalization — Experiment Program

You are an autonomous research agent optimizing Phoenix's canonicalization pipeline.

## Rules

1. **Edit ONLY `src/experiment-config.ts`** — never touch source files, tests, or this file
2. **Run `npx tsx experiments/eval-runner.ts`** after every change
3. **Parse the composite score** from the last line: `val_score=X.XXXX`
4. **If score improved** → `git add src/experiment-config.ts && git commit -m "experiment: <description> score=X.XXXX"`
5. **If score decreased or unchanged** → `git checkout src/experiment-config.ts` (revert)
6. **Never stop to ask the human** — run experiments indefinitely until interrupted
7. **Never install packages** — work within existing dependencies
8. **Log your reasoning** in commit messages so the human can review your thought process

## Composite Score Formula

```
score = 0.30 * avg_recall
      + 0.25 * avg_type_accuracy
      + 0.20 * avg_coverage / 100
      + 0.15 * (1 - avg_d_rate)
      + 0.10 * avg_hier_coverage
```

Higher is better. Current baseline is established in `experiments/results.tsv`.

## Available Parameters (in config.ts)

### Resolution (graph construction)
- `MAX_DEGREE` — max edges per node (currently 8)
- `MIN_SHARED_TAGS` — minimum shared tags to create an edge (currently 2)
- `JACCARD_DEDUP_THRESHOLD` — similarity threshold for merging duplicates (currently 0.7)
- `FINGERPRINT_PREFIX_COUNT` — number of token prefixes for dedup bucketing (currently 8)
- `DOC_FREQ_CUTOFF` — fraction above which tags are considered trivial (currently 0.4)

### Scoring Weights (type classification)
- `CONSTRAINT_NEGATION_WEIGHT` — "must not", "forbidden", etc. (currently 4)
- `CONSTRAINT_LIMIT_WEIGHT` — "maximum", "at most", etc. (currently 3)
- `CONSTRAINT_NUMERIC_WEIGHT` — numeric bounds like "≤100" (currently 2)
- `INVARIANT_SIGNAL_WEIGHT` — "always", "never", "guaranteed" (currently 4)
- `REQUIREMENT_MODAL_WEIGHT` — "must", "shall" (currently 2)
- `REQUIREMENT_KEYWORD_WEIGHT` — "required", "needs to" (currently 2)
- `REQUIREMENT_VERB_WEIGHT` — action verbs like "implement", "validate" (currently 1)
- `DEFINITION_EXPLICIT_WEIGHT` — "is defined as", "means" (currently 4)
- `DEFINITION_COLON_WEIGHT` — "Term: definition" pattern (currently 3)
- `CONTEXT_NO_MODAL_WEIGHT` — no modal verbs present (currently 2)
- `CONTEXT_SHORT_WEIGHT` — short sentence without modals (currently 1)
- `HEADING_CONTEXT_BONUS` — bonus from heading keywords (currently 2)
- `CONSTRAINT_MUST_BONUS` — extra constraint credit for "must" (currently 1)

### Confidence & Extraction
- `MIN_CONFIDENCE` / `MAX_CONFIDENCE` — confidence bounds (currently 0.3 / 1.0)
- `DEFINITION_MAX_LENGTH` — max text length for definition detection (currently 200)
- `MIN_EXTRACTION_LENGTH` — minimum sentence length to extract (currently 5)
- `MIN_TERM_LENGTH` — minimum hyphenated compound length (currently 3)
- `MIN_WORD_LENGTH` — minimum individual word length for terms (currently 2)

### Sentence Segmentation
- `MIN_LIST_ITEM_LENGTH` — minimum list item character length (currently 3)
- `MIN_PROSE_SENTENCE_LENGTH` — minimum prose sentence length (currently 3)
- `PROSE_SPLIT_THRESHOLD` — text length below which no sentence splitting (currently 80)
- `MIN_SPLIT_PART_LENGTH` — minimum part length for compound splits (currently 3)

### Warm Hashing
- `WARM_MIN_CONFIDENCE` — minimum confidence for warm hash inclusion (currently 0.3)

### Change Classification
- `CLASS_A_NORM_DIFF` / `CLASS_A_TERM_DELTA` — thresholds for trivial (currently 0.1 / 0.2)
- `CLASS_B_NORM_DIFF` / `CLASS_B_TERM_DELTA` — thresholds for local semantic (currently 0.5 / 0.5)
- `CLASS_D_HIGH_CHANGE` — threshold for uncertain classification (currently 0.7)
- `ANCHOR_MATCH_THRESHOLD` — anchor overlap to rescue from D→B (currently 0.5)

## Research Priorities

_Edit this section to steer the agent's focus._

1. **Maximize recall** — the gold-standard nodes that aren't being found. This is the highest-weighted component.
2. **Improve type accuracy** — correct classification of REQUIREMENT vs CONSTRAINT vs INVARIANT.
3. **Reduce D-rate** — lower the fraction of 'relates_to' fallback edges.
4. **Tune dedup** — the Jaccard threshold (0.7) and fingerprint settings might be too aggressive or too loose.
5. **Explore scoring weight ratios** — the relative weights between type signals matter more than absolute values.

## Strategy Tips

- Change ONE parameter at a time to isolate effects
- Try both directions (increase and decrease) for each parameter
- The scoring weights interact — after finding a good single-param change, try combinations
- The resolution parameters (JACCARD_DEDUP_THRESHOLD, DOC_FREQ_CUTOFF) affect graph structure globally
- Small changes to MIN_EXTRACTION_LENGTH or PROSE_SPLIT_THRESHOLD can change which sentences get extracted at all
- Watch for overfitting: if one spec improves dramatically but others drop, the change isn't generalizable
