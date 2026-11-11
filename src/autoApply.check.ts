/**
 * Checks for `autoApply.ts`. Run with `node src/autoApply.check.ts`.
 */

import { decideAutoApply, RESTORE_FACTOR } from "./autoApply.ts";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const profiles = [
  { processes: ["game.exe"], autoApply: true, autoSpeed: 1.5 },
  { processes: ["other.exe"], autoApply: false, autoSpeed: 3 },
  { processes: ["plain.exe"], autoApply: true },
];

const fresh = { appliedExe: null, userTouched: false };

// ── The profile asks for it ────────────────────────────────────────────────

const apply = decideAutoApply(profiles, "game.exe", fresh);
assert(apply.action === "apply", "a matching profile applies its speed");
assert(apply.action === "apply" && apply.factor === 1.5, "the profile's factor is used");
assert(apply.action === "apply" && apply.exe === "game.exe", "the exe is reported back");

// Applying twice in a row must not fight the bridge.
const again = decideAutoApply(profiles, "game.exe", { appliedExe: "game.exe", userTouched: false });
assert(again.action === "none", "the same exe is not applied twice");

// ── Leaving the exe restores 1.0 ──────────────────────────────────────────

const leave = decideAutoApply(profiles, "notepad.exe", { appliedExe: "game.exe", userTouched: false });
assert(leave.action === "restore", "leaving the exe restores the speed");
assert(leave.action === "restore" && leave.factor === RESTORE_FACTOR, "the restore factor is 1.0");

const idle = decideAutoApply(profiles, "notepad.exe", fresh);
assert(idle.action === "none", "nothing to restore when nothing was applied");

// ── The user wins ──────────────────────────────────────────────────────────

const touched = decideAutoApply(profiles, "game.exe", { appliedExe: null, userTouched: true });
assert(touched.action === "none", "a manual change stops the automatic speed");

const touchedRestore = decideAutoApply(profiles, "notepad.exe", { appliedExe: "game.exe", userTouched: true });
assert(touchedRestore.action === "none", "a manual change also stops the restore");

// ── Only profiles that ask for it count ────────────────────────────────────

assert(decideAutoApply(profiles, "other.exe", fresh).action === "none", "autoApply=false is ignored");
assert(decideAutoApply(profiles, "plain.exe", fresh).action === "none", "a profile without a speed is ignored");
assert(decideAutoApply(profiles, "", fresh).action === "none", "no foreground exe changes nothing");

// The name is matched on the file part only.
assert(
  decideAutoApply(profiles, "C:\\Games\\game.exe", fresh).action === "apply",
  "a full path still matches",
);

console.log("autoApply.check ok");
