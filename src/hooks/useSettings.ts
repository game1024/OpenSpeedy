import { useState, useCallback, useEffect } from "react";
import { useSyncExternalStore } from "react";
import { invoke } from "@tauri-apps/api/core";
import { type SettingsState } from "../store/settings";
import { loadSettings, setSetting } from "../store/settings";

// ── Module-level store (useSyncExternalStore compatible) ────────────────────

let _loaded = false;
let _cache: SettingsState | null = null;
const _listeners = new Set<() => void>();

function subscribe(callback: () => void) {
  _listeners.add(callback);
  return () => { _listeners.delete(callback); };
}

function getSnapshot(): SettingsState | null {
  return _cache;
}

function emit() {
  _listeners.forEach(fn => fn());
}

// ── Hooks ───────────────────────────────────────────────────────────────────

export function useSettings() {
  const settings = useSyncExternalStore(subscribe, getSnapshot);

  // Initial load (async, but useSyncExternalStore handles subsequent updates)
  useEffect(() => {
    if (!_loaded || !_cache) {
      loadSettings().then(s => {
        _cache = s;
        _loaded = true;
        emit();
      });
    }
  }, []);

  const getAll = useCallback(async (): Promise<SettingsState> => {
    const s = await loadSettings();
    _cache = s;
    _loaded = true;
    emit();
    return s;
  }, []);

  const get = useCallback(<K extends keyof SettingsState>(key: K): SettingsState[K] => {
    return (_cache?.[key] ?? null) as SettingsState[K];
  }, []);

  const set = useCallback(async <K extends keyof SettingsState>(key: K, value: SettingsState[K]) => {
    _cache = { ..._cache!, [key]: value };
    emit();
    await setSetting(key, value);
  }, []);

  return { settings, getAll, get, set };
}

/** Subscribe to a single Settings key — returns its current value and updates on change. */
export function useSettingsValue<K extends keyof SettingsState>(key: K): SettingsState[K] | undefined {
  return useSyncExternalStore(
    subscribe,
    useCallback(() => _cache?.[key], [key]),
  );
}

export function useSpeed() {
  const { set } = useSettings();
  const [speed, setSpeed] = useState(1.0);
  const persistedSpeed = useSettingsValue("speed");

  // Sync persisted → local (initial load + cross-component changes)
  useEffect(() => {
    if (persistedSpeed !== undefined) setSpeed(persistedSpeed as number);
  }, [persistedSpeed]);

  // Sync saved speed to bridge on startup
  useEffect(() => {
    invoke<number | null>("bridge_get_speed").then(current => {
      loadSettings().then(s => {
        if (s.speed && current !== s.speed) {
          invoke("bridge_set_speed", { factor: s.speed });
        }
      });
    });
  }, []);

  const updateSpeed = useCallback((s: number) => {
    setSpeed(s);
  }, []);

  const commitSpeed = useCallback(async (s: number) => {
    setSpeed(s);
    await invoke("bridge_set_speed", { factor: s });
    await set("speed", s);
  }, [set]);

  return { speed, setSpeed: updateSpeed, commitSpeed };
}
