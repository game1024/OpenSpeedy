/**
 * Channel arbitration (stage 2).
 *
 * A slot may be driven by exactly one channel: a registered hotkey, the
 * read-only poller, or the gamepad reader. Two channels on one slot would
 * fire the same action twice — `increase` would add a full step instead of
 * half — so the assignment lives in one pure function that can be checked
 * without a keyboard.
 */

export type InputChannel = "hotkey" | "poll" | "gamepad";

export interface SlotCandidate {
  slot: string;
  shortcut: string;
}

export interface ArbitrationOptions {
  /** Chords the OS refused (error 1409 — another program holds them). */
  degraded: readonly string[];
  /** Compatibility mode: every keyboard chord is polled. */
  compat: boolean;
  /** Whether the polling channel is available at all. */
  polling: boolean;
}

const PAD_PREFIX = "Pad:";

export function isGamepadChord(shortcut: string): boolean {
  return shortcut.startsWith(PAD_PREFIX);
}

/** One channel per slot. Later candidates for the same slot never override. */
export function assignChannels(
  candidates: readonly SlotCandidate[],
  options: ArbitrationOptions,
): Record<string, InputChannel> {
  const degraded = new Set(options.degraded);
  const out: Record<string, InputChannel> = {};
  for (const candidate of candidates) {
    if (out[candidate.slot]) continue;
    if (isGamepadChord(candidate.shortcut)) {
      out[candidate.slot] = "gamepad";
      continue;
    }
    if (!options.polling) {
      out[candidate.slot] = "hotkey";
      continue;
    }
    if (options.compat || degraded.has(candidate.shortcut)) {
      out[candidate.slot] = "poll";
      continue;
    }
    out[candidate.slot] = "hotkey";
  }
  return out;
}

/** The chords that have to be polled, in slot order. */
export function polledChords(
  candidates: readonly SlotCandidate[],
  options: ArbitrationOptions,
): { slot: string; chord: string }[] {
  const channels = assignChannels(candidates, options);
  return candidates
    .filter(candidate => channels[candidate.slot] === "poll")
    .map(candidate => ({ slot: candidate.slot, chord: candidate.shortcut }));
}
