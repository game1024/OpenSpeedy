/**
 * Registration guards for the hotkey table (stage 1).
 *
 * Two things live here, both pure so they can be checked without a window:
 * the combinations Windows keeps for itself, and the retry schedule used when
 * the OS refuses a chord because another program already holds it.
 */

/**
 * Combos the OS never hands to a normal application. `F12` is reserved for the
 * debugger, the rest belong to the shell. Registering them either fails or —
 * worse — succeeds and then does nothing, so they are refused before the call.
 */
export const RESERVED_COMBOS: readonly string[] = [
  "ctrl+alt+delete",
  "ctrl+alt+del",
  "win+l",
  "win+u",
  "alt+tab",
  "ctrl+escape",
  "ctrl+esc",
  "win+space",
  "f12",
];

/** Comparison form: token order and letter case must not matter. */
export function comboKey(combo: string): string {
  return combo
    .split("+")
    .map(token => token.trim().toLowerCase())
    .filter(Boolean)
    .sort()
    .join("+");
}

const RESERVED_KEYS = new Set(RESERVED_COMBOS.map(comboKey));

export function isReservedCombo(combo: string): boolean {
  if (!combo.trim()) return false;
  return RESERVED_KEYS.has(comboKey(combo));
}

/**
 * Retry delays for a chord another program holds: 2 s, 4 s, 8 s, then every
 * 10 s. Capped so a long-lived conflict does not keep waking the machine up at
 * an ever-growing interval, and short enough that releasing the key in the
 * other program brings the hotkey back within one step.
 */
export const RETRY_DELAYS_MS: readonly number[] = [2000, 4000, 8000, 10000];

/** `attempt` is zero-based; anything past the schedule stays on the last step. */
export function retryDelay(attempt: number): number {
  const index = Math.max(0, Math.min(attempt, RETRY_DELAYS_MS.length - 1));
  return RETRY_DELAYS_MS[index]!;
}
