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
  alwaysOnTop: boolean;
  hideToTray: boolean;
  language: "zh-CN" | "zh-TW" | "ja-JP" | "ko-KR" | "de-DE" | "fr-FR" | "en-US" | "ru-RU" | "hi-IN" | "nl-NL" | "pt-BR" | "es-ES";
  speed: number;
}

// ── Defaults ──────────────────────────────────────────────────────────────

export const DEFAULTS: SettingsState = {
  increaseSpeedShortcut: "",
  increaseSpeedStep: 0.5,
  decreaseSpeedShortcut: "",
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
  alwaysOnTop: false,
  // Closing the window tucks the app away in the tray. On by default, which is
  // how the app has always behaved; turn it off to make the close button exit.
  hideToTray: true,
  language: "en-US" as const,
  speed: 1.0,
};

// ── Store (singleton) ─────────────────────────────────────────────────────

import { Store } from "@tauri-apps/plugin-store";
import { locale } from "@tauri-apps/plugin-os";
import { mapSystemLocale } from "../i18n";

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

export async function setSetting<K extends keyof SettingsState>(key: K, value: SettingsState[K]) {
  const store = await getStore();
  const saved = (await store.get<SettingsState>("settings")) || ({} as SettingsState);
  saved[key] = value;
  await store.set("settings", saved);
  await store.save();
}
