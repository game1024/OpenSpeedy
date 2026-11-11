/**
 * Checks for `channelArbitration.ts`. Run with `node src/channelArbitration.check.ts`.
 */

import { assignChannels, isGamepadChord, polledChords } from "./channelArbitration.ts";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const candidates = [
  { slot: "increaseSpeedShortcut", shortcut: "Ctrl+Alt+]" },
  { slot: "decreaseSpeedShortcut", shortcut: "Ctrl+Alt+[" },
  { slot: "holdShortcut", shortcut: "Pad:LB+A" },
];

// ── The normal case ────────────────────────────────────────────────────────

const normal = assignChannels(candidates, { degraded: [], compat: false, polling: true });
assert(normal.increaseSpeedShortcut === "hotkey", "a free chord stays a hotkey");
assert(normal.holdShortcut === "gamepad", "a pad binding stays on the gamepad");
assert(Object.keys(normal).length === 3, "every slot has exactly one channel");

// ── A chord the OS refused falls back to polling ───────────────────────────

const degraded = assignChannels(candidates, {
  degraded: ["Ctrl+Alt+]"],
  compat: false,
  polling: true,
});
assert(degraded.increaseSpeedShortcut === "poll", "a 1409 chord is polled");
assert(degraded.decreaseSpeedShortcut === "hotkey", "the other chord is untouched");
assert(Object.keys(degraded).length === 3, "falling back does not add a second channel");

// ── The double-trigger this whole module exists to prevent ────────────────

// One entry per slot: a slot can never be listed on two channels, so one
// press cannot add a full step instead of half.
assert(
  Object.keys(degraded).length === new Set(candidates.map(candidate => candidate.slot)).size,
  "the channel map holds one entry per slot",
);
assert(degraded.increaseSpeedShortcut === "poll", "the refused chord is polled instead of hotkey");
assert(
  Object.values(degraded).filter(channel => channel === "poll").length === 1,
  "exactly one slot moved to the poller",
);

// ── Compatibility mode ─────────────────────────────────────────────────────

const compat = assignChannels(candidates, { degraded: [], compat: true, polling: true });
assert(compat.increaseSpeedShortcut === "poll", "compatibility mode polls every chord");
assert(compat.decreaseSpeedShortcut === "poll", "compatibility mode polls every chord");
assert(compat.holdShortcut === "gamepad", "a pad binding is not affected by compatibility mode");

// ── With polling unavailable, nothing moves ────────────────────────────────

const off = assignChannels(candidates, { degraded: ["Ctrl+Alt+]"], compat: true, polling: false });
assert(off.increaseSpeedShortcut === "hotkey", "no polling means no fallback");
assert(off.decreaseSpeedShortcut === "hotkey", "no polling means no fallback");

// ── The polled list only contains polled slots ─────────────────────────────

const polled = polledChords(candidates, { degraded: ["Ctrl+Alt+]"], compat: false, polling: true });
assert(polled.length === 1, "one chord is polled");
assert(polled[0]!.slot === "increaseSpeedShortcut", "the right slot is polled");
assert(polled[0]!.chord === "Ctrl+Alt+]", "the right chord is polled");

assert(isGamepadChord("Pad:LB+A"), "pad chords are recognised");
assert(!isGamepadChord("Ctrl+Alt+]"), "keyboard chords are not pads");

console.log("channelArbitration.check ok");
