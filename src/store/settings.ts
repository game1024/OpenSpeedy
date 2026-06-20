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

  autoStart: boolean;
  alwaysOnTop: boolean;
  language: "zh-CN" | "zh-TW" | "ja-JP" | "ko-KR" | "de-DE" | "fr-FR" | "en-US";
  speed: number;
}

// ── Defaults ──────────────────────────────────────────────────────────────

export const DEFAULTS: SettingsState = {
  increaseSpeedShortcut: "Ctrl+Alt+ArrowUp",
  increaseSpeedStep: 0.5,
  decreaseSpeedShortcut: "Ctrl+Alt+ArrowDown",
  decreaseSpeedStep: 0.5,
  resetSpeedShortcut: "Ctrl+Alt+0",

  gear1Shortcut: "Shift+1",
  gear1Speed: 1.0,
  gear2Shortcut: "Shift+2",
  gear2Speed: 2.0,
  gear3Shortcut: "Shift+3",
  gear3Speed: 5.0,
  gear4Shortcut: "",
  gear4Speed: 10.0,
  gear5Shortcut: "",
  gear5Speed: 100.0,

  autoStart: false,
  alwaysOnTop: false,
  language: "zh-CN" as const,
  speed: 1.0,
};

// ── Store (singleton) ─────────────────────────────────────────────────────

import { Store } from "@tauri-apps/plugin-store";

let _store: Store | null = null;

async function getStore() {
  if (!_store) _store = await Store.load("settings.json");
  return _store;
}

export async function loadSettings(): Promise<SettingsState> {
  const store = await getStore();
  const saved = await store.get<SettingsState>("settings");
  return { ...DEFAULTS, ...saved } as SettingsState;
}

export async function getSetting<K extends keyof SettingsState>(key: K): Promise<SettingsState[K]> {
  const store = await getStore();
  const saved = await store.get<SettingsState>("settings");
  const merged = { ...DEFAULTS, ...saved } as SettingsState;
  return merged[key];
}

export async function setSetting<K extends keyof SettingsState>(key: K, value: SettingsState[K]) {
  const store = await getStore();
  const saved = (await store.get<SettingsState>("settings")) || ({} as SettingsState);
  saved[key] = value;
  await store.set("settings", saved);
  await store.save();
}
