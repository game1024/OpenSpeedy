import { useCallback, useEffect, useSyncExternalStore } from "react";
import { invoke } from "@tauri-apps/api/core";

// ── Types (mirror src-tauri/src/auto_accel.rs) ────────────────────────────

export interface AutoRule {
  /** Executable name, e.g. "game.exe". Matching is case-insensitive. */
  name: string;
  exe_path: string | null;
  arch: string | null;
  speed: number;
  /** 1..5 when bound to a gear instead of a literal multiplier. */
  gear: number | null;
}

export interface AutoAccelConfig {
  enabled: boolean;
  rules: AutoRule[];
  gear_speeds?: number[];
}

const EMPTY: AutoAccelConfig = { enabled: false, rules: [] };

// ── Module-level store (shared by the settings panel and process detail) ───

let _cache: AutoAccelConfig = EMPTY;
let _loaded = false;
let _loading: Promise<AutoAccelConfig> | null = null;
const _listeners = new Set<() => void>();

function subscribe(callback: () => void) {
  _listeners.add(callback);
  return () => { _listeners.delete(callback); };
}

function getSnapshot(): AutoAccelConfig {
  return _cache;
}

function emit() {
  _listeners.forEach(fn => fn());
}

function publish(config: AutoAccelConfig) {
  _cache = config;
  _loaded = true;
  emit();
}

// ── Backend calls ────────────────────────────────────────────────────────

export async function getAutoAccelConfig(): Promise<AutoAccelConfig> {
  if (!_loading) {
    _loading = invoke<AutoAccelConfig>("get_auto_accel_config")
      .then(config => { publish(config); return config; })
      .finally(() => { _loading = null; });
  }
  return _loading;
}

export async function setAutoAccelEnabled(enabled: boolean): Promise<void> {
  const config = await invoke<AutoAccelConfig>("set_auto_accel_enabled", { enabled });
  publish(config);
}

export async function upsertAutoRule(rule: AutoRule): Promise<void> {
  const config = await invoke<AutoAccelConfig>("upsert_auto_rule", { rule });
  publish(config);
}

export async function removeAutoRule(name: string): Promise<void> {
  const config = await invoke<AutoAccelConfig>("remove_auto_rule", { name });
  publish(config);
}

/** Keep gear bindings following the gear multipliers defined in settings. */
export async function setAutoGearSpeeds(speeds: number[]): Promise<void> {
  const config = await invoke<AutoAccelConfig>("set_auto_gear_speeds", { speeds });
  publish(config);
}

/** Factor currently applied by the background monitor, or null when idle. */
export async function getActiveAutoSpeed(): Promise<number | null> {
  try {
    return await invoke<number | null>("get_auto_accel_active_speed");
  } catch {
    return null;
  }
}

/** `[pid, is32]` pairs the Rust monitor has injected. */
export async function getAppliedPids(): Promise<[number, boolean][]> {
  try {
    return await invoke<[number, boolean][]>("get_auto_accel_applied_pids");
  } catch {
    return [];
  }
}

// ── Hook ─────────────────────────────────────────────────────────────────

export function useAutoAccel() {
  const config = useSyncExternalStore(subscribe, getSnapshot);

  useEffect(() => {
    if (!_loaded) void getAutoAccelConfig().catch(() => {});
  }, []);

  const refresh = useCallback(async () => {
    await getAutoAccelConfig();
  }, []);

  return { config, refresh };
}
