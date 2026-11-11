// ── Types ──────────────────────────────────────────────────────────────────

export interface SettingsState {
  [key: string]: string | number | boolean;

  increaseSpeedShortcut: string;
  increaseSpeedStep: number;
  decreaseSpeedShortcut: string;
  decreaseSpeedStep: number;
  resetSpeedShortcut: string;

  gear1Shortcut: string;
  gear1Speed: number;
  gear2Shortcut: string;
  gear2Speed: number;
  gear3Shortcut: string;
  gear3Speed: number;
  gear4Shortcut: string;
  gear4Speed: number;
  gear5Shortcut: string;
  gear5Speed: number;

  holdShortcut: string;
  holdSpeed: number;

  theme: "light" | "dark";
  autoStart: boolean;
  silentAutostart: boolean;
  alwaysOnTop: boolean;
  hideToTray: boolean;
  language: "zh-CN" | "zh-TW" | "ja-JP" | "ko-KR" | "de-DE" | "fr-FR" | "en-US" | "ru-RU" | "hi-IN" | "nl-NL" | "pt-BR" | "es-ES";
  speed: number;

  /**
   * Stage switch for the input-observation work. Off by default: it only adds
   * `[input]` records to the diagnostics log and unlocks the one-press check,
   * never a new way of touching a game.
   */
  "input.observe": boolean;

  /** Stage-1 switch: retry chords the OS refused, 2 s → 10 s backoff. */
  "hotkey.retry": boolean;

  /** Stage-2 switch: the read-only polling channel. */
  "input.polling": boolean;

  /** Stage-2 switch: send every keyboard chord through the poller. */
  "input.compat": boolean;

  /** Stage-3 switch: the shortcut action runs in Rust, not in the webview. */
  "dispatch.rust": boolean;

  /** Stage-4 rollback switch: hard deny → strong warning. Off = hard deny. */
  "guard.warn_only": boolean;

  /** Stage-5 switch: a profile may apply its own speed automatically. */
  "auto.apply": boolean;

  /** Stage-6 switch: the local control page on 127.0.0.1. */
  "remote.control": boolean;
}

// ── Defaults ──────────────────────────────────────────────────────────────

export const DEFAULTS: SettingsState = {
  // Overlay-friendly by default: the bracket pair is rarely claimed by games or
  // by the shell, unlike the function keys these slots used to carry. Only new
  // installs see this — an existing settings file wins on merge.
  increaseSpeedShortcut: "Ctrl+Alt+]",
  increaseSpeedStep: 0.5,
  decreaseSpeedShortcut: "Ctrl+Alt+[",
  decreaseSpeedStep: 0.5,
  resetSpeedShortcut: "Ctrl+Alt+0",

  gear1Shortcut: "Ctrl+Shift+1",
  gear1Speed: 1.0,
  gear2Shortcut: "Ctrl+Shift+2",
  gear2Speed: 2.0,
  gear3Shortcut: "Ctrl+Shift+3",
  gear3Speed: 5.0,
  gear4Shortcut: "",
  gear4Speed: 10.0,
  gear5Shortcut: "",
  gear5Speed: 100.0,

  holdShortcut: "",
  holdSpeed: 2.0,

  theme: "light" as const,
  autoStart: false,
  // Boot launches stay in the tray instead of opening the window. Off unless
  // asked for: a window nobody expected is worse than one nobody wanted.
  silentAutostart: false,
  alwaysOnTop: false,
  // Closing the window tucks the app away in the tray. On by default, which is
  // how the app has always behaved; turn it off to make the close button exit.
  hideToTray: true,
  language: "en-US" as const,
  speed: 1.0,
  // Stage 0 rollback switch. Turning it off restores the pre-stage-0 log
  // volume without touching any code.
  "input.observe": false,
  // Stage 1 rollback switch. Off keeps the old "a refused chord stays refused"
  // behaviour; on retries it on the 2 s → 10 s schedule.
  "hotkey.retry": false,
  // Stage 2 rollback switch. Off leaves the hotkey table as the only channel.
  "input.polling": false,
  // Stage 2: compatibility mode, every chord polled instead of registered.
  "input.compat": false,
  // Stage 3 rollback switch. Off keeps the action in the webview.
  "dispatch.rust": false,
  // Stage 4 rollback switch. Off = hard deny for protected games; on degrades
  // the module to a strong warning (the documented rollback condition).
  "guard.warn_only": false,
  // Stage 5 rollback switch. Off keeps the speed entirely in the user's hands.
  "auto.apply": false,
  // Stage 6 rollback switch. Off keeps the port closed.
  "remote.control": false,
};

// ── Store (singleton) ─────────────────────────────────────────────────────

import { Store } from "@tauri-apps/plugin-store";
import { locale } from "@tauri-apps/plugin-os";
import { mapSystemLocale } from "../i18n";
import { normalizeProfiles, type ShortcutProfile } from "../shortcutProfile";

let _store: Store | null = null;

async function getStore() {
  if (!_store) _store = await Store.load("settings.json");
  return _store;
}

export async function loadSettings(): Promise<SettingsState> {
  const store = await getStore();
  const saved = await store.get<SettingsState>("settings");
  const merged = { ...DEFAULTS, ...saved } as SettingsState;

  // If user has never set a language, use the OS locale
  if (!saved?.language) {
    const sysLocale = await locale();
    merged.language = mapSystemLocale(sysLocale) as SettingsState["language"];
  }

  return merged;
}

export async function getSetting<K extends keyof SettingsState>(key: K): Promise<SettingsState[K]> {
  const store = await getStore();
  const saved = await store.get<SettingsState>("settings");
  const merged = { ...DEFAULTS, ...saved } as SettingsState;

  // If user has never set a language, use the OS locale
  if (!saved?.language) {
    const sysLocale = await locale();
    merged.language = mapSystemLocale(sysLocale) as SettingsState["language"];
  }

  return merged[key];
}

// `setSetting` is a read-modify-write across several awaits. Two concurrent
// writes would otherwise interleave (A.get → B.get → A.set → B.set) and B
// would silently discard A's change. Serialise them on a single chain while
// keeping the same async signature for every caller.
let _writeQueue: Promise<void> = Promise.resolve();

export function setSetting<K extends keyof SettingsState>(key: K, value: SettingsState[K]): Promise<void> {
  const run = async () => {
    const store = await getStore();
    const saved = (await store.get<SettingsState>("settings")) || ({} as SettingsState);
    saved[key] = value;
    await store.set("settings", saved);
    await store.save();
  };
  const next = _writeQueue.then(run, run);
  _writeQueue = next.catch(() => {});
  return next;
}

/** Sibling of `settings` in settings.json. Missing key loads as an empty list. */
export async function loadShortcutProfiles(): Promise<ShortcutProfile[]> {
  const store = await getStore();
  return normalizeProfiles(await store.get<unknown>("shortcutProfiles"));
}

export async function saveShortcutProfiles(profiles: readonly ShortcutProfile[]) {
  const store = await getStore();
  await store.set("shortcutProfiles", normalizeProfiles(profiles));
  await store.save();
}
