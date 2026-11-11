/**
 * Auto-apply rules (stage 5).
 *
 * A profile can ask for a speed to be applied automatically while one of its
 * exes is in the foreground. The decision is a pure function so the rules can
 * be checked without a foreground window: the user always wins — once they
 * changed the speed by hand, nothing overwrites it for the rest of the
 * session.
 */

export interface AutoApplyProfile {
  processes: string[];
  autoApply?: boolean;
  autoSpeed?: number;
}

export interface AutoApplyState {
  /** The exe an automatic speed is currently applied for. */
  appliedExe: string | null;
  /** The user changed the speed by hand in this session. */
  userTouched: boolean;
}

export type AutoApplyDecision =
  | { action: "none" }
  | { action: "apply"; exe: string; factor: number }
  | { action: "restore"; factor: number };

function exeKey(name: string): string {
  const parts = name.trim().split(/[/\\]/);
  const base = parts[parts.length - 1] ?? "";
  return base.toLowerCase();
}

/** The speed that is restored when the auto-applied exe is no longer in front. */
export const RESTORE_FACTOR = 1.0;

/**
 * What should happen for the foreground `exe`?
 *
 * - no profile asks for it → restore 1.0 if something was applied before;
 * - a profile asks for it → apply its factor, once per exe;
 * - the user took over → nothing at all.
 */
export function decideAutoApply(
  profiles: readonly AutoApplyProfile[],
  exe: string,
  state: AutoApplyState,
): AutoApplyDecision {
  if (state.userTouched) return { action: "none" };

  const key = exeKey(exe);
  const profile = key
    ? profiles.find(item =>
        item.autoApply === true &&
        typeof item.autoSpeed === "number" &&
        item.autoSpeed > 0 &&
        item.processes.some(proc => exeKey(proc) === key),
      )
    : undefined;

  if (!profile) {
    return state.appliedExe ? { action: "restore", factor: RESTORE_FACTOR } : { action: "none" };
  }
  if (state.appliedExe === exe) return { action: "none" };
  return { action: "apply", exe, factor: profile.autoSpeed as number };
}
