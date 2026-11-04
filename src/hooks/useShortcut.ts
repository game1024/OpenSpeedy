import { useSyncExternalStore } from "react";
import * as GlobalShortcut from "@tauri-apps/plugin-global-shortcut";
import { invoke } from "@tauri-apps/api/core";
import { useSettings } from "./useSettings";
import { loadSettings, loadShortcutProfiles, setSetting } from "../store/settings";
import type { SettingsState } from "../store/settings";
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

function remember(shortcut: string, ok: boolean) {
  _statusCache = { ..._statusCache, [shortcut]: ok };
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
let pollTimer: ReturnType<typeof setInterval> | null = null;
let suspended = 0;

function runSlot(slot: ShortcutSlot, phase: "press" | "release") {
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
  if (entry.hold) {
    if (state === "Pressed") {
      holdChord = entry.shortcut;
      runSlot(entry.slot, "press");
    } else if (holdChord === entry.shortcut) {
      holdChord = null;
      runSlot(entry.slot, "release");
    }
    return;
  }
  if (state === "Pressed") runSlot(entry.slot, "press");
}

async function registerChord(entry: RegEntry) {
  const handler = (state: "Pressed" | "Released") => onChord(entry, state);
  try {
    await GlobalShortcut.register(entry.shortcut, (event: ShortcutTriggerState) => handler(event.state));
    remember(entry.shortcut, true);
    console.log("[shortcut] register OK:", entry.shortcut);
  } catch (e) {
    console.error("[shortcut] register FAIL:", entry.shortcut, e);
    remember(entry.shortcut, false);
  }
}

async function unregisterChord(shortcut: string) {
  if (!shortcut) return;
  if (await GlobalShortcut.isRegistered(shortcut)) {
    await GlobalShortcut.unregister(shortcut);
  }
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

async function applyActive(force: boolean) {
  const foreground = await foregroundName();
  const foregroundChanged = foreground !== lastForeground;
  if (primed && !force && !foregroundChanged && (suspended === 0 || active.length === 0)) return;

  if (suspended > 0) {
    for (const entry of active) await unregisterChord(entry.shortcut);
    active = [];
    activeSig = "";
    lastForeground = foreground;
    return;
  }

  const [settings, profiles] = await Promise.all([loadSettings(), loadShortcutProfiles()]);
  activeOverrides = speedOverrides(profiles, foreground);
  const next = registrationEntries(resolveShortcuts(globalShortcuts(settings), profiles, foreground));
  const nextSig = registrationSignature(next);
  if (primed && nextSig === activeSig) {
    lastForeground = foreground;
    return;
  }

  if (holdChord) {
    holdChord = null;
    invoke("bridge_set_speed", { factor: 1.0 });
    persistSpeed(1);
  }
  if (!primed) {
    await GlobalShortcut.unregisterAll().catch(() => {});
    _statusCache = {};
    emit();
    active = [];
    primed = true;
  }
  const diff = diffRegistration(active, next);
  for (const shortcut of diff.remove) await unregisterChord(shortcut);
  for (const entry of diff.add) await registerChord(entry);
  active = next;
  activeSig = nextSig;
  lastForeground = foreground;
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

/** Drop hotkeys so a shortcut field can see a key that is already registered. */
export function suspendShortcuts(): Promise<void> {
  suspended++;
  return enqueue(true);
}

export function resumeShortcuts(): Promise<void> {
  if (suspended > 0) suspended--;
  return enqueue(true);
}

function startPoll() {
  if (pollTimer) return;
  // ponytail: polls one window every 400ms. Upgrade path: EVENT_SYSTEM_FOREGROUND.
  pollTimer = setInterval(() => { void enqueue(false); }, 400);
  void enqueue(true);
}

export function initShortcuts() {
  startPoll();
}

// ── Hook ────────────────────────────────────────────────────────────────────

export function useShortcut() {
  const { get, set } = useSettings();
  const shortcutStatus = useSyncExternalStore(subscribe, getSnapshot);
  persistSpeed = (n) => { void set("speed", n); };
  readNumber = (key) => {
    const value = get(key as keyof SettingsState);
    return typeof value === "number" ? value : 0;
  };

  return { init: initShortcuts, syncShortcuts, shortcutStatus };
}
