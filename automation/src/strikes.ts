// Pure functions for strike calculation. The PRD's algorithm:
//   1. Read previous close from oracle.
//   2. Generate strikes at ±percentages of prev close.
//   3. Round each to the nearest $X (default $10).
//   4. Deduplicate (low-priced stocks like AAPL may collapse multiple
//      percentages onto the same strike).
//   5. Optionally include the rounded prev close itself.
//
// All prices are integer USD cents to match the on-chain representation.

export interface StrikeCalcOptions {
  percentages: number[];
  /// Round-to step in cents (e.g. 1000 = round to nearest $10).
  roundToCents: number;
  /// Whether to include the rounded prev close itself as a strike.
  includeAtTheMoney?: boolean;
}

export function calculateStrikes(
  prevCloseUsdCents: number,
  opts: StrikeCalcOptions
): number[] {
  const set = new Set<number>();
  for (const pct of opts.percentages) {
    const above = (prevCloseUsdCents * (100 + pct)) / 100;
    const below = (prevCloseUsdCents * (100 - pct)) / 100;
    const aboveR = roundToNearest(above, opts.roundToCents);
    const belowR = roundToNearest(below, opts.roundToCents);
    if (aboveR > 0) set.add(aboveR);
    if (belowR > 0) set.add(belowR);
  }
  if (opts.includeAtTheMoney) {
    const atm = roundToNearest(prevCloseUsdCents, opts.roundToCents);
    if (atm > 0) set.add(atm);
  }
  return Array.from(set).sort((a, b) => a - b);
}

export function roundToNearest(value: number, step: number): number {
  if (step <= 0) throw new Error("step must be > 0");
  return Math.round(value / step) * step;
}
