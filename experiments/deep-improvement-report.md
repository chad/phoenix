# Phoenix Deep Improvement: Autoresearch Report

## Categories

### 1. Type Classification Accuracy (TypeAcc)
Current: 89% avg across 18 gold specs
Target: 95%+
Levers: scoring weights, confidence formula, tie-breaking, action-verb detection

### 2. Edge Inference Quality (D-Rate / Untyped Edge Rate)
Current: 6% avg
Target: <3%
Levers: SAME_TYPE_REFINE_THRESHOLD, DOC_FREQ_CUTOFF, MIN_SHARED_TAGS, fingerprint precision

### 3. Code Generation Reliability (arch eval pass rate)
Current: 100% on simple spec, untested on regeneration variance
Target: 100% across 5 consecutive bootstraps
Levers: prompt wording, retry logic, architecture examples

### 4. Change Classification Accuracy
Current: untested (no gold-standard change pairs)
Target: establish baseline, then improve
Levers: CLASS_A/B/D thresholds, confidence formula, anchor overlap

### 5. Deduplication Precision
Current: unmeasured
Target: establish baseline, then improve
Levers: JACCARD_DEDUP_THRESHOLD, fingerprint length, type compatibility rules

---

## Experiment Log

(Updated as experiments run)
