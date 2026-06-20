import { useState, useEffect, useCallback } from "react";
import { type SettingsState } from "../store/settings";
import { loadSettings, setSetting } from "../store/settings";

let _loaded = false;
let _cache: SettingsState | null = null;
const _listeners = new Set<() => void>();

function emit() { _listeners.forEach(f => f()); }

export function useSettings() {
  const [settings, setSettings] = useState<SettingsState | null>(_cache);

  // Subscribe to changes from other instances
  useEffect(() => {
    const cb = () => setSettings({ ..._cache! });
    _listeners.add(cb);
    return () => { _listeners.delete(cb); };
  }, []);

  useEffect(() => {
    if (_loaded) return;
    _loaded = true;
    loadSettings().then(s => { _cache = s; emit(); });
  }, []);

  const getAll = useCallback(async (): Promise<SettingsState> => {
    const s = await loadSettings();
    _cache = s;
    return s;
  }, []);

  const get = useCallback(<K extends keyof SettingsState>(key: K): SettingsState[K] => {
    return (_cache?.[key] ?? null) as SettingsState[K];
  }, [settings]);

  const set = useCallback(async <K extends keyof SettingsState>(key: K, value: SettingsState[K]) => {
    _cache = { ..._cache!, [key]: value };
    emit();
    await setSetting(key, value);
  }, []);

  const setGearShortcut = useCallback((gear: number, shortcut: string) => {
    return set(`gear${gear}Shortcut` as keyof SettingsState, shortcut);
  }, [set]);

  const setGearSpeed = useCallback((gear: number, speed: number) => {
    return set(`gear${gear}Speed` as keyof SettingsState, speed);
  }, [set]);

  return { settings, getAll, get, set, setGearShortcut, setGearSpeed };
}
