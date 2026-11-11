import { useState, useCallback, useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { useSyncExternalStore } from "react";
import { invoke } from "@tauri-apps/api/core";
import { type SettingsState } from "../store/settings";
import { loadSettings, setSetting } from "../store/settings";
import { dispatchInRustEnabled, markUserSpeedChange } from "../inputMode";

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

  // Stage 3: the Rust dispatcher reports the factor it applied. This is the
  // only place the stored value is written in that mode, so there is exactly
  // one writer for it.
  useEffect(() => {
    let stop: (() => void) | undefined;
    let dead = false;
    listen<{ factor: number }>("speed-changed", event => {
      const factor = event.payload?.factor;
      if (typeof factor !== "number" || !Number.isFinite(factor)) return;
      setSpeed(factor);
      void set("speed", factor);
    }).then(unlisten => {
      if (dead) unlisten();
      else stop = unlisten;
    }).catch(() => {});
    return () => { dead = true; stop?.(); };
  }, [set]);

  // Sync saved speed to bridge on startup
  useEffect(() => {
    invoke<number | null>("bridge_get_speed").then(current => {
      loadSettings().then(s => {
        if (current !== null && current !== s.speed) {
          if (dispatchInRustEnabled()) {
            // The bridge holds the truth in this mode; the stored value
            // follows it instead of overwriting it.
            void set("speed", current);
          } else if (s.speed) {
            invoke("bridge_set_speed", { factor: s.speed });
          }
        }
      });
    });
  }, [set]);

  const updateSpeed = useCallback((s: number) => {
    setSpeed(s);
  }, []);

  const commitSpeed = useCallback(async (s: number) => {
    setSpeed(s);
    // A manual change ends the automatic speed for this session — the user
    // wins over any profile.
    markUserSpeedChange();
    await invoke("bridge_set_speed", { factor: s });
    await set("speed", s);
  }, [set]);

  return { speed, setSpeed: updateSpeed, commitSpeed };
}
