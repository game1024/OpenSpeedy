/**
 * Verdict logic for the diagnostics page's one-press check.
 *
 * The check has three observable steps — the OS accepted the registration, the
 * callback fired, the bridge accepted a speed change — and the verdict names
 * the first one that failed. Keeping the decision here (instead of inline in
 * the component) is what makes the three failure modes testable without a
 * window, a keyboard, or a game.
 */

export type DiagVerdict =
  | "not_registered"
  | "registered_no_fire"
  | "fired_no_inject"
  | "ok";

export interface DiagEvidence {
  /** `null` when the probe never reached the registration call. */
  register: { ok: boolean; code?: number } | null;
  fired: boolean;
  /**
   * Whether the bridge accepted a speed change after the callback fired.
   * `null` means it was never asked.
   */
  injectOk: boolean | null;
}

/**
 * First failure wins: a registration that never happened explains a silent
 * combination, so it must not be reported as "registered but never fired".
 */
export function classify(evidence: DiagEvidence): DiagVerdict {
  if (!evidence.register || !evidence.register.ok) return "not_registered";
  if (!evidence.fired) return "registered_no_fire";
  // No confirmed speed change means the chain stops at the injection, which is
  // reported as a failure rather than an unknown — the user needs an action.
  return evidence.injectOk === true ? "ok" : "fired_no_inject";
}
