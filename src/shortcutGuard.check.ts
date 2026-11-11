/**
 * Checks for `shortcutGuard.ts`. Run with `node src/shortcutGuard.check.ts`.
 */

import { comboKey, isReservedCombo, retryDelay, RETRY_DELAYS_MS } from "./shortcutGuard.ts";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

// ── Every combo the plan lists must be refused ─────────────────────────────

for (const combo of [
  "Ctrl+Alt+Delete",
  "Win+L",
  "Win+U",
  "Alt+Tab",
  "Ctrl+Escape",
  "Ctrl+Esc",
  "Win+Space",
  "F12",
]) {
  assert(isReservedCombo(combo), `${combo} must be treated as reserved`);
}

// Case and token order are not part of the identity.
assert(isReservedCombo("alt+ctrl+delete"), "reordered tokens still match");
assert(isReservedCombo("F12"), "a bare function key matches");
assert(!isReservedCombo("f11"), "F11 is not reserved on Windows");

// Everything the app actually ships as a default must stay usable.
for (const combo of ["Ctrl+Alt+]", "Ctrl+Alt+[", "Ctrl+Alt+0", "Ctrl+Shift+1", "NUMPADADD", "Pad:LB+A"]) {
  assert(!isReservedCombo(combo), `${combo} must not be treated as reserved`);
}

assert(!isReservedCombo(""), "an unset slot is not reserved");
assert(comboKey("Ctrl+Shift+A") === comboKey("shift+ctrl+a"), "comparison form ignores order and case");

// ── Retry schedule ─────────────────────────────────────────────────────────

assert(retryDelay(0) === 2000, "first retry waits 2 s");
assert(retryDelay(1) === 4000, "second retry backs off to 4 s");
assert(retryDelay(2) === 8000, "third retry backs off to 8 s");
assert(retryDelay(3) === 10000, "cap reached at 10 s");
assert(retryDelay(99) === 10000, "the cap never grows");
assert(retryDelay(-1) === RETRY_DELAYS_MS[0], "a negative attempt is clamped");
assert(RETRY_DELAYS_MS.length === 4, "schedule length is part of the contract");

console.log("shortcutGuard.check ok");
