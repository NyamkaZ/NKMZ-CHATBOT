/**
 * Timing for answers that arrive complete (FAQ replies served without the
 * model): they are revealed from the first character like a streamed answer.
 * Progress is derived from the arrival time, so leaving the chat and coming
 * back continues the reveal instead of restarting it.
 */
const MS_PER_CHARACTER = 16;
const MIN_DURATION = 450;
const MAX_DURATION = 4000;

/** How long revealing `length` characters takes, in milliseconds. */
export function revealDuration(length: number): number {
  if (length <= 0) return 0;
  return Math.min(MAX_DURATION, Math.max(MIN_DURATION, length * MS_PER_CHARACTER));
}

/** How many of `length` characters are visible `elapsed` ms after arrival. */
export function revealedCount(length: number, elapsed: number): number {
  const duration = revealDuration(length);
  if (duration === 0 || elapsed >= duration) return Math.max(0, length);
  if (elapsed <= 0) return 0;
  return Math.min(length, Math.ceil((elapsed / duration) * length));
}
