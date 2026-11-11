import { useEffect, useSyncExternalStore } from "react";
import * as GlobalShortcut from "@tauri-apps/plugin-global-shortcut";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useSettings } from "./useSettings";
import { loadSettings, loadShortcutProfiles, setSetting } from "../store/settings";
import type { SettingsState } from "../store/settings";
import { isReservedCombo, retryDelay } from "../shortcutGuard";
import { assignChannels, polledChords } from "../channelArbitration";
import { setDispatchInRust, userTouchedSpeedFlag } from "../inputMode";
import { decideAutoApply } from "../autoApply";
import { getAcceleratedNames } from "../store/process";
import { reportError } from "../utils/frontendLog";
import {
  diffRegistration,
  globalShortcuts,
  registrationEntries,
  registrationSignature,
  resolveShortcuts,
  speedOverrides,
  type RegEntry,
  type ShortcutSlot,
  type SpeedValueKey,
} from "../shortcutProfile";

type ShortcutTriggerState = {
  id: number;
  shortcut: string;
  state: "Pressed" | "Released";
};

const PAD_PREFIX = "Pad:";

export function isGamepadShortcut(shortcut: string): boolean {
  return shortcut.startsWith(PAD_PREFIX);
}

/** Stored `Pad:LB+A` is shown as `LB+A`. Unlabeled buttons drop the vendor id. */
export function shortcutLabel(shortcut: string): string {
  const body = isGamepadShortcut(shortcut) ? shortcut.slice(PAD_PREFIX.length) : shortcut;
  return body.split("+").map(prettyToken).join("+");
}

function prettyToken(key: string): string {
  const raw = /^V[0-9A-F]{4}P[0-9A-F]{4}([BAH])(\d+)([A-Za-z]*)$/.exec(key);
  if (!raw) return key;
  if (raw[1] === "B") return `B${raw[2]}`;
  if (raw[1] === "A") return `Axis${raw[2]}`;
  return raw[3] || `Hat${raw[2]}`;
}

type PadHandler = (state: "Pressed" | "Released") => void;
const padHandlers = new Map<string, PadHandler>();
let padListening = false;

function ensurePadListener() {
  if (padListening) return;
  padListening = true;
  void listen<{ binding: string; state: "Pressed" | "Released" }>("gamepad-chord", (event) => {
    padHandlers.get(event.payload.binding)?.(event.payload.state);
  }).catch(e => {
    // Do not leave the flag set: a failed registration would otherwise make
    // the whole gamepad channel silently dead until the app is restarted.
    padListening = false;
    void reportError("shortcut", "gamepad listener failed", String(e));
  });
}

/** The poller reports its own edges; the handler table dispatches them. */
function ensurePollListener() {
  if (pollListening) return;
  pollListening = true;
  void listen<{ slot: string; phase: "press" | "release" }>("input-polled", (event) => {
    const slot = event.payload.slot as ShortcutSlot;
    if (event.payload.phase === "press") {
      traceInput("hotkey_fired", { slot, channel: "poll" });
    }
    runSlot(slot, event.payload.phase, "poll");
  }).catch(e => {
    pollListening = false;
    void reportError("shortcut", "input-polled listener failed", String(e));
  });
}

function remember(shortcut: string, ok: boolean, retryable = true) {
  _statusCache = { ..._statusCache, [shortcut]: ok };
  // Every chord the OS refused is retried on a timer. Two cases are excluded:
  // gamepad bindings (no OS table involved) and refusals that no retry can
  // change (a reserved combination, a duplicate pad binding).
  if (ok || !retryable || isGamepadShortcut(shortcut)) failedChords.delete(shortcut);
  else failedChords.add(shortcut);
  emit();
}

// ── Module-level store (useSyncExternalStore compatible) ────────────────────

let _statusCache: Record<string, boolean> = {};
const _statusListeners = new Set<() => void>();

function subscribe(callback: () => void) {
  _statusListeners.add(callback);
  return () => { _statusListeners.delete(callback); };
}

function getSnapshot(): Record<string, boolean> {
  return _statusCache;
}

function emit() {
  _statusListeners.forEach(fn => fn());
}

export function shortcutRegistered(shortcut: string): boolean | undefined {
  if (!shortcut) return undefined;
  return _statusCache[shortcut];
}

// ── Input trace (stage 0) ──────────────────────────────────────────────────
//
// Records land in the diagnostics log as `[input]` lines. `input.observe` gates
// both halves: this flag decides whether the webview emits, and
// `set_input_trace` decides whether Rust writes — so switching it off really
// does return the log to its previous shape.

let traceEnabled = false;
let tracePushed: boolean | null = null;

export function applyInputTrace(on: boolean) {
  traceEnabled = on;
  if (tracePushed === on) return;
  tracePushed = on;
  void invoke("set_input_trace", { enabled: on }).catch(() => { tracePushed = null; });
}

export type InputChannel = "hotkey" | "poll" | "gamepad";

interface TraceFields {
  slot?: string;
  channel?: InputChannel;
  code?: number;
  pid?: number;
  ok?: boolean;
  reason?: string;
}

/** Fire-and-forget: a failed trace must never break a shortcut. */
export function traceInput(
  event: "register_fail" | "hotkey_fired" | "inject_result",
  fields: TraceFields,
) {
  if (!traceEnabled) return;
  void invoke("input_trace", { event, ...fields }).catch(() => {});
}

// ── Active registration (one list, for the foreground exe only) ────────────

let persistSpeed: (n: number) => void = (n) => { void setSetting("speed", n); };
let readNumber: (key: string) => number = () => 0;
let activeOverrides: Partial<Record<SpeedValueKey, number>> = {};

function speedOf(key: SpeedValueKey, fallback: number): number {
  const pinned = activeOverrides[key];
  if (typeof pinned === "number") return pinned;
  return readNumber(key) || fallback;
}

let chain: Promise<void> = Promise.resolve();
let primed = false;
let active: RegEntry[] = [];
let activeSig = "";
let holdChord: string | null = null;
let lastForeground = "";
let watching = false;
let suspended = 0;

/** Chords the OS refused, and the retry state for them (stage 1). */
const failedChords = new Set<string>();
let retryTimer: number | undefined;
let retryAttempt = 0;
let retryEnabled = false;
/** Signature of the polled slot list, so a channel change re-runs the pass. */
let activePollSig = "";

/**
 * Chords the OS refused with 1409 — another program owns them. When the
 * polling channel is available these slots are moved over to it, which is why
 * a slot never sits on both channels at once.
 */
const degradedChords = new Set<string>();
let pollEnabled = false;
let compatMode = false;
/** Stage 3: the action runs in Rust instead of in the webview. */
let dispatchInRust = false;

/** Stage 5: the automatic speed. */
let autoApplyEnabled = false;
let autoAppliedExe: string | null = null;
let pollListening = false;

/** A suspend that is never resumed would leave every hotkey dead. */
const SUSPEND_TIMEOUT_MS = 30_000;
let suspendTimer: number | undefined;

function runSlot(slot: ShortcutSlot, phase: "press" | "release", source: InputChannel = "hotkey") {
  // Stage 3: the action runs in Rust, which asks the bridge for the current
  // factor and reports the result. The webview only displays it.
  if (dispatchInRust) {
    void invoke("input_dispatch", { slot, phase, source }).catch(() => {});
    return;
  }
  if (slot === "increaseSpeedShortcut" && phase === "press") {
    invoke<number | null>("bridge_get_speed").then(current => {
      const next = (current ?? 1) + speedOf("increaseSpeedStep", 0.5);
      invoke("bridge_set_speed", { factor: next });
      persistSpeed(next);
    });
    return;
  }
  if (slot === "decreaseSpeedShortcut" && phase === "press") {
    invoke<number | null>("bridge_get_speed").then(current => {
      const next = Math.max(0.01, (current ?? 1) - speedOf("decreaseSpeedStep", 0.5));
      invoke("bridge_set_speed", { factor: next });
      persistSpeed(next);
    });
    return;
  }
  if (slot === "resetSpeedShortcut" && phase === "press") {
    invoke("bridge_set_speed", { factor: 1.0 });
    persistSpeed(1);
    return;
  }
  if (slot.startsWith("gear") && phase === "press") {
    const speed = speedOf(slot.replace("Shortcut", "Speed") as SpeedValueKey, 1);
    invoke("bridge_set_speed", { factor: speed });
    persistSpeed(speed);
    return;
  }
  if (slot === "holdShortcut") {
    const factor = phase === "press" ? speedOf("holdSpeed", 2) : 1;
    invoke("bridge_set_speed", { factor });
    persistSpeed(factor);
  }
}

function onChord(entry: RegEntry, state: "Pressed" | "Released") {
  if (entry.conflict) return;
  // One line per press, so a report can tell "never arrived" apart from
  // "arrived but did nothing". Releases are not part of the schema.
  if (state === "Pressed") {
    traceInput("hotkey_fired", {
      slot: entry.slot,
      channel: isGamepadShortcut(entry.shortcut) ? "gamepad" : "hotkey",
    });
  }
  const source = isGamepadShortcut(entry.shortcut) ? "gamepad" : "hotkey";
  if (entry.hold) {
    if (state === "Pressed") {
      holdChord = entry.shortcut;
      runSlot(entry.slot, "press", source);
    } else if (holdChord === entry.shortcut) {
      holdChord = null;
      runSlot(entry.slot, "release", source);
    }
    return;
  }
  if (state === "Pressed") runSlot(entry.slot, "press", source);
}

async function registerChord(entry: RegEntry) {
  // Pad chords never reach the OS hotkey API; gamepad.rs reports the edges and
  // the handler table here dispatches them.
  if (isGamepadShortcut(entry.shortcut)) {
    ensurePadListener();
    if (padHandlers.has(entry.shortcut)) {
      remember(entry.shortcut, false, false);
      return;
    }
    padHandlers.set(entry.shortcut, (state) => onChord(entry, state));
    remember(entry.shortcut, true);
    return;
  }
  // Refused before the call: Windows keeps these for the shell and the
  // debugger, and a successful registration would still never fire.
  if (isReservedCombo(entry.shortcut)) {
    console.warn("[shortcut] reserved combination refused for", entry.slot);
    remember(entry.shortcut, false, false);
    return;
  }
  try {
    await GlobalShortcut.register(entry.shortcut, (event: ShortcutTriggerState) => onChord(entry, event.state));
    remember(entry.shortcut, true);
    // Never print the chord itself: the [input] schema is slot-only on purpose.
    console.log("[shortcut] register OK:", entry.slot);
  } catch (e) {
    console.error("[shortcut] register FAIL:", entry.slot);
    // The plugin surfaces the Win32 failure as text, not a code. 1409 is
    // ERROR_HOTKEY_ALREADY_REGISTERED, the only case that is recognised here;
    // anything else stays absent rather than being guessed.
    const text = e instanceof Error ? e.message : String(e);
    const occupied = /already|in use/i.test(text);
    traceInput("register_fail", { slot: entry.slot, code: occupied ? 1409 : undefined });
    remember(entry.shortcut, false);
    // Another program owns this combination. The polling channel can still
    // read it, so the slot moves over instead of staying dead — as long as
    // the combination is one Windows does not reserve.
    if (occupied && pollEnabled && !isReservedCombo(entry.shortcut)) {
      degradedChords.add(entry.shortcut);
      void enqueue(true).catch(() => {});
    }
  }
}

async function unregisterChord(shortcut: string) {
  if (!shortcut) return;
  if (isGamepadShortcut(shortcut)) {
    padHandlers.delete(shortcut);
  } else if (await GlobalShortcut.isRegistered(shortcut)) {
    await GlobalShortcut.unregister(shortcut);
  }
  // Nothing is registered under this chord any more, so there is nothing left
  // to retry either.
  failedChords.delete(shortcut);
  const { [shortcut]: _, ...rest } = _statusCache;
  _statusCache = rest;
  emit();
}

async function foregroundName(): Promise<string> {
  try {
    return (await invoke<string>("foreground_exe_name")) ?? "";
  } catch (e) {
    console.error("[shortcut] foreground", e);
    return lastForeground;
  }
}

/** Apply (or restore) the speed a profile asks for while its exe is in
 *  front. Nothing happens once the user has changed the speed by hand. */
async function handleAutoApply(exe: string) {
  if (!autoApplyEnabled) return;
  const profiles = await loadShortcutProfiles().catch(() => []);
  const decision = decideAutoApply(profiles, exe, {
    appliedExe: autoAppliedExe,
    userTouched: userTouchedSpeedFlag(),
  });
  if (decision.action === "none") return;
  if (decision.action === "apply") autoAppliedExe = decision.exe;
  else autoAppliedExe = null;
  void invoke("bridge_set_speed", { factor: decision.factor }).catch(() => {});
  persistSpeed(decision.factor);
}

/** The speed values the Rust dispatcher needs — the effective ones, so a
 *  profile override reaches the dispatcher as well. */
async function pushDispatchConfig() {
  const gears = [1, 2, 3, 4, 5].map(index =>
    speedOf(`gear${index}Speed` as SpeedValueKey, 1),
  );
  void invoke("input_config", {
    increaseStep: speedOf("increaseSpeedStep", 0.5),
    decreaseStep: speedOf("decreaseSpeedStep", 0.5),
    gears,
    holdSpeed: speedOf("holdSpeed", 2),
  }).catch(() => {});
}

/** Hand the polled slots over to the Rust poller. */
function pushPollBindings(list: { slot: string; chord: string }[]) {
  if (!pollEnabled) {
    void invoke("input_poll_enable", { enabled: false }).catch(() => {});
    void invoke("input_poll_set", { bindings: [] }).catch(() => {});
    return;
  }
  ensurePollListener();
  void invoke("input_poll_set", { bindings: list.map(item => [item.slot, item.chord]) }).catch(() => {});
  void invoke("input_poll_enable", { enabled: true }).catch(() => {});
}

/** Exes that count as "a game is in front of the user" — they get the fast
 *  polling period. */
async function pushFocusExes(profiles: { processes: string[] }[]) {
  const remembered = await getAcceleratedNames().catch(() => [] as string[]);
  const exes = [...profiles.flatMap(profile => profile.processes), ...remembered];
  void invoke("input_poll_focus_exes", { exes }).catch(() => {});
}

function cancelRetry() {
  if (retryTimer !== undefined) {
    window.clearTimeout(retryTimer);
    retryTimer = undefined;
  }
  retryAttempt = 0;
}

function scheduleRetry() {
  if (!retryEnabled || retryTimer !== undefined || suspended > 0 || failedChords.size === 0) return;
  const delay = retryDelay(retryAttempt++);
  retryTimer = window.setTimeout(() => {
    retryTimer = undefined;
    void enqueue(true);
  }, delay);
}

async function applyActive(force: boolean) {
  const foreground = await foregroundName();
  const foregroundChanged = foreground !== lastForeground;
  // A failed chord needs another pass even when the foreground did not move —
  // that early return is what used to freeze a hotkey as dead until the user
  // switched windows.
  const pendingRetry = failedChords.size > 0;
  if (primed && !force && !foregroundChanged && !pendingRetry && (suspended === 0 || active.length === 0)) return;

  if (suspended > 0) {
    for (const entry of active) await unregisterChord(entry.shortcut);
    active = [];
    activeSig = "";
    activePollSig = "";
    degradedChords.clear();
    lastForeground = foreground;
    cancelRetry();
    pushPollBindings([]);
    return;
  }

  const [settings, profiles] = await Promise.all([loadSettings(), loadShortcutProfiles()]);
  activeOverrides = speedOverrides(profiles, foreground);
  const next = registrationEntries(resolveShortcuts(globalShortcuts(settings), profiles, foreground));
  // Retry state for a chord that is no longer configured would loop forever:
  // nothing would ever register it, so nothing would ever clear it.
  for (const chord of [...failedChords]) {
    if (!next.some(entry => entry.shortcut === chord)) failedChords.delete(chord);
  }
  for (const chord of [...degradedChords]) {
    if (!next.some(entry => entry.shortcut === chord)) degradedChords.delete(chord);
  }

  // One channel per slot. A chord that is polled is not registered as a
  // hotkey, so a single press can never trigger the action twice.
  const candidates = next.map(entry => ({ slot: entry.slot, shortcut: entry.shortcut }));
  const options = { degraded: [...degradedChords], compat: compatMode, polling: pollEnabled };
  const channels = assignChannels(candidates, options);
  const hotkeyEntries = next.filter(entry => channels[entry.slot] !== "poll");
  const polled = polledChords(candidates, options);
  // A chord that moved to the poller has nothing left to retry.
  for (const item of polled) failedChords.delete(item.chord);

  const nextSig = registrationSignature(hotkeyEntries);
  const pollSig = polled.map(item => `${item.slot}\0${item.chord}`).sort().join("\n");
  // A chord another app holds stays in the list; it is retried on the schedule
  // below instead of waiting for a foreground change that may never come.
  const stillFailing = hotkeyEntries.filter(entry => failedChords.has(entry.shortcut));
  if (primed && nextSig === activeSig && pollSig === activePollSig && stillFailing.length === 0) {
    lastForeground = foreground;
    cancelRetry();
    return;
  }

  if (holdChord && nextSig !== activeSig) {
    holdChord = null;
    invoke("bridge_set_speed", { factor: 1.0 });
    persistSpeed(1);
  }
  if (!primed) {
    await GlobalShortcut.unregisterAll().catch(() => {});
    padHandlers.clear();
    _statusCache = {};
    failedChords.clear();
    emit();
    primed = true;
  }
  // Failed chords are not actually registered, so the diff has to see them as
  // absent; otherwise it reports "nothing changed" and never retries them.
  const live = active.filter(entry => !failedChords.has(entry.shortcut));
  const diff = diffRegistration(live, hotkeyEntries);
  for (const shortcut of diff.remove) await unregisterChord(shortcut);
  for (const entry of diff.add) await registerChord(entry);
  active = hotkeyEntries;
  activeSig = nextSig;
  activePollSig = pollSig;
  lastForeground = foreground;
  pushPollBindings(polled);
  if (pollEnabled) void pushFocusExes(profiles);
  void pushDispatchConfig();

  if (failedChords.size === 0) cancelRetry();
  else scheduleRetry();
}

function enqueue(force: boolean): Promise<void> {
  const run = chain.then(() => applyActive(force), () => applyActive(force));
  chain = run.then(() => {}, () => {});
  return run;
}

/** Reload shortcuts for the current foreground window. */
export function syncShortcuts(): Promise<void> {
  return enqueue(true);
}

/** Stage-1 switch `hotkey.retry`: off means a refused chord stays refused. */
export function applyHotkeyRetry(on: boolean) {
  retryEnabled = on;
  if (on) scheduleRetry();
  else cancelRetry();
}

function clearSuspendTimer() {
  if (suspendTimer !== undefined) {
    window.clearTimeout(suspendTimer);
    suspendTimer = undefined;
  }
}

/** Drop hotkeys so a shortcut field can see a key that is already registered. */
export function suspendShortcuts(): Promise<void> {
  suspended++;
  // A recording field that is destroyed without calling resume (a crash in the
  // webview, a dialog torn down by navigation) would otherwise leave every
  // hotkey unregistered for the rest of the session.
  if (suspendTimer === undefined) {
    suspendTimer = window.setTimeout(() => {
      suspendTimer = undefined;
      if (suspended === 0) return;
      console.warn("[shortcut] suspend timed out after 30 s — restoring hotkeys");
      suspended = 0;
      void enqueue(true);
    }, SUSPEND_TIMEOUT_MS);
  }
  return enqueue(true);
}

export function resumeShortcuts(): Promise<void> {
  if (suspended > 0) suspended--;
  if (suspended === 0) clearSuspendTimer();
  return enqueue(true);
}

export function initShortcuts() {
  if (watching) return;
  watching = true;
  // Rust watches the foreground window. A webview timer stalls while the window sits in the tray.
  void listen<string>("foreground-changed", (event) => {
    void enqueue(false).catch(() => {});
    void handleAutoApply(typeof event.payload === "string" ? event.payload : "");
  }).catch(e => {
    watching = false;
    void reportError("shortcut", "foreground listener failed", String(e));
  });
  void enqueue(true);
}

// ── Hook ────────────────────────────────────────────────────────────────────

export function useShortcut() {
  const { get, set } = useSettings();
  const shortcutStatus = useSyncExternalStore(subscribe, getSnapshot);
  const observe = get("input.observe") === true;
  const retry = get("hotkey.retry") === true;
  const polling = get("input.polling") === true;
  const compat = get("input.compat") === true;
  const rustDispatch = get("dispatch.rust") === true;
  const autoApply = get("auto.apply") === true;
  const guardWarnOnly = get("guard.warn_only") === true;
  useEffect(() => { applyInputTrace(observe); }, [observe]);
  useEffect(() => { applyHotkeyRetry(retry); }, [retry]);
  useEffect(() => {
    // Both switches change which channel a slot belongs to, so the whole
    // registration list has to be rebuilt.
    pollEnabled = polling;
    compatMode = compat;
    void enqueue(true).catch(() => {});
  }, [polling, compat]);
  useEffect(() => {
    // Stage 3: the action moves into Rust. The frontend keeps the same
    // shortcut handling, it just hands the action over.
    dispatchInRust = rustDispatch;
    setDispatchInRust(rustDispatch);
    void invoke("input_dispatch_mode", { enabled: rustDispatch }).catch(() => {});
  }, [rustDispatch]);
  useEffect(() => {
    // Stage 4: the guard is always on; this switch only degrades a hard deny
    // to a strong warning. Pushed on mount too, so a persisted rollback
    // survives a restart without opening the diagnostics page.
    void invoke("injection_guard_mode", { warnOnly: guardWarnOnly }).catch(() => {});
  }, [guardWarnOnly]);
  useEffect(() => {
    // Stage 5: the automatic speed follows the foreground exe.
    autoApplyEnabled = autoApply;
    if (!autoApply) autoAppliedExe = null;
  }, [autoApply]);
  persistSpeed = (n) => { void set("speed", n); };
  readNumber = (key) => {
    const value = get(key as keyof SettingsState);
    return typeof value === "number" ? value : 0;
  };

  return { init: initShortcuts, syncShortcuts, shortcutStatus };
}
