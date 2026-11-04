import { useState, useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import { useInterval } from "ahooks";
import { invoke } from "@tauri-apps/api/core";
import { type SettingsState } from "../store/settings";
import { loadSettings, setSetting } from "../store/settings";
import { getActiveAutoSpeed } from "../store/autoAccel";

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
  // While a bound game is running the background monitor owns the global
  // factor; do not let the persisted manual speed overwrite it.
  const autoOwnsSpeed = useRef(false);
  const lastAutoFactor = useRef<number | null>(null);

  // Sync persisted → local (initial load + cross-component changes)
  useEffect(() => {
    if (persistedSpeed !== undefined && !autoOwnsSpeed.current) {
      setSpeed(persistedSpeed as number);
    }
  }, [persistedSpeed]);

  // Sync saved speed to bridge on startup, unless auto acceleration already
  // applied a factor before this WebView finished loading (silent boot case).
  useEffect(() => {
    (async () => {
      const active = await getActiveAutoSpeed();
      if (active !== null && Number.isFinite(active)) {
        autoOwnsSpeed.current = true;
        lastAutoFactor.current = active;
        setSpeed(active);
        return;
      }
      try {
        const current = await invoke<number | null>("bridge_get_speed");
        const s = await loadSettings();
        if (s.speed && current !== s.speed) {
          await invoke("bridge_set_speed", { factor: s.speed });
        }
      } catch { /* bridge not ready yet — the next poll will pick it up */ }
    })();
  }, []);

  // Follow factors applied later (a bound game starting while the app is open).
  // Only a *change* of the active factor moves the slider, so a manual override
  // is never fought by the monitor.
  useInterval(async () => {
    const active = await getActiveAutoSpeed();
    if (active === lastAutoFactor.current) return;
    lastAutoFactor.current = active;
    if (active !== null && Number.isFinite(active)) {
      autoOwnsSpeed.current = true;
      setSpeed(active);
    } else {
      autoOwnsSpeed.current = false;
    }
  }, 1000);

  const updateSpeed = useCallback((s: number) => {
    autoOwnsSpeed.current = false;
    setSpeed(s);
  }, []);

  const commitSpeed = useCallback(async (s: number) => {
    autoOwnsSpeed.current = false;
    setSpeed(s);
    await invoke("bridge_set_speed", { factor: s });
    await set("speed", s);
  }, [set]);

  return { speed, setSpeed: updateSpeed, commitSpeed };
}
