/**
 * Bench statistics — the smallest honest summary of a proportion.
 *
 * One rule, enforced by the type: a rate is never reported without the interval that
 * produced it. `4/5` and `40/50` are the same rate and different facts; printing the
 * first as "80%" is a claim the sample cannot support.
 *
 * The interval is a 95% Wilson score interval — the range of true rates consistent with
 * what was actually drawn. Wilson rather than normal-approximation because the counts
 * here are small and often at the boundary (0/50, 50/50), exactly where the normal
 * approximation returns intervals that include impossible rates.
 *
 * There are no p-values and no significance tests anywhere in this module. When two
 * intervals overlap the only statement available is "these runs do not distinguish these
 * rates" — never "the rates are the same", never "this one is better". A verdict wearing
 * a number is still a verdict, and the harness is not entitled to make it for the reader.
 *
 * (The discipline here is lifted wholesale from the Sedum eval harness — see
 * ACKNOWLEDGEMENTS in README.md.)
 */

/** 95% two-sided normal quantile. The only confidence level the harness offers. */
const Z = 1.959963984540054;

export interface Interval {
  /** Successes. */
  readonly k: number;
  /** Denominator — samples that were actually eligible to succeed. */
  readonly n: number;
  /** k/n, or null when n = 0. A rate over nothing is not zero; it is absent. */
  readonly rate: number | null;
  /** Wilson lower bound (0 when n = 0). */
  readonly lo: number;
  /** Wilson upper bound (1 when n = 0). */
  readonly hi: number;
}

/**
 * 95% Wilson score interval for k successes in n trials.
 *
 * n = 0 yields the uninformative interval [0, 1] with a null rate: the honest statement
 * about a proportion nobody sampled is that anything is possible, not that it is zero.
 */
export function wilson(k: number, n: number): Interval {
  if (!Number.isFinite(k) || !Number.isFinite(n) || k < 0 || n < 0 || k > n) {
    throw new Error(`wilson: invalid counts k=${k} n=${n}`);
  }
  if (n === 0) return { k: 0, n: 0, rate: null, lo: 0, hi: 1 };

  const p = k / n;
  const z2 = Z * Z;
  const denom = 1 + z2 / n;
  const centre = (p + z2 / (2 * n)) / denom;
  const half = (Z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;

  return {
    k,
    n,
    rate: p,
    // The boundaries are exact facts, not floating-point dust: 0 successes cannot support
    // a positive lower bound, and n successes cannot support an upper bound below 1.
    lo: k === 0 ? 0 : Math.max(0, centre - half),
    hi: k === n ? 1 : Math.min(1, centre + half),
  };
}

/** `34/50 [0.54, 0.79]` — the fraction and the interval, always together. */
export function formatInterval(iv: Interval): string {
  if (iv.n === 0) return '—/0 (no samples)';
  return `${iv.k}/${iv.n} [${iv.lo.toFixed(2)}, ${iv.hi.toFixed(2)}]`;
}

/** Convenience: count and format in one step. */
export function formatRate(k: number, n: number): string {
  return formatInterval(wilson(k, n));
}

/**
 * Do two intervals overlap?
 *
 * This is the ONLY comparison the harness makes. `false` licenses "these runs
 * distinguish these rates"; `true` licenses "these runs do not distinguish these rates".
 * Neither licenses "A is better than B" — that sentence needs an effect size and a
 * pre-registered question, and this harness has neither.
 */
export function overlaps(a: Interval, b: Interval): boolean {
  if (a.n === 0 || b.n === 0) return true; // nothing is distinguished by nothing
  return a.lo <= b.hi && b.lo <= a.hi;
}

/** The sentence a comparison is allowed to print. */
export function compareSentence(labelA: string, a: Interval, labelB: string, b: Interval): string {
  if (a.n === 0 || b.n === 0) {
    return `${labelA} and ${labelB} cannot be compared — one of them has no eligible samples.`;
  }
  return overlaps(a, b)
    ? `These runs do NOT distinguish ${labelA} ${formatInterval(a)} from ${labelB} ${formatInterval(b)}.`
    : `These runs distinguish ${labelA} ${formatInterval(a)} from ${labelB} ${formatInterval(b)} (intervals disjoint).`;
}
