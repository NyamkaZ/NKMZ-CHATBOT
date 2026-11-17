/**
 * Usage is shown to people as a percentage; the actual message counts stay
 * internal. The rounding never claims "0% left" while a message remains, or
 * "100% left" once something has been used.
 */
export function remainingPercent(remaining: number, limit: number): number {
  if (!(limit > 0) || remaining <= 0) return 0;
  if (remaining >= limit) return 100;
  return Math.min(99, Math.max(1, Math.round((remaining / limit) * 100)));
}

/** The share of today's allowance already used, as a whole percentage. */
export function usedPercent(used: number, limit: number): number {
  if (!(limit > 0)) return 0;
  return 100 - remainingPercent(limit - used, limit);
}
