import { useCallback } from "react";
import { useSyncExternalStore } from "react";
import * as GlobalShortcut from "@tauri-apps/plugin-global-shortcut";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useSettings } from "./useSettings";

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
  });
}

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

// ── Hook ────────────────────────────────────────────────────────────────────

export function useShortcut() {
  const { getAll, get, set } = useSettings();
  const shortcutStatus = useSyncExternalStore(subscribe, getSnapshot);

  const doRegister = useCallback(async (
    shortcut: string,
    handler: (s: ShortcutTriggerState) => void,
  ): Promise<boolean> => {
    if (!shortcut) return false;
    try {
      await GlobalShortcut.register(shortcut, handler);
      _statusCache = { ..._statusCache, [shortcut]: true };
      emit();
      console.log("[shortcut] register OK:", shortcut);
      return true;
    } catch (e) {
      console.error("[shortcut] register FAIL:", shortcut, e);
      _statusCache = { ..._statusCache, [shortcut]: false };
      emit();
      return false;
    }
  }, []);

  const register = useCallback(async (shortcut: string, callback: () => void): Promise<boolean> => {
    if (isGamepadShortcut(shortcut)) {
      ensurePadListener();
      if (padHandlers.has(shortcut)) {
        remember(shortcut, false);
        return false;
      }
      padHandlers.set(shortcut, (state) => {
        if (state === "Pressed") callback();
      });
      remember(shortcut, true);
      return true;
    }
    return doRegister(shortcut, ({ state }: ShortcutTriggerState) => {
      if (state !== "Pressed") return;
      callback();
    });
  }, [doRegister]);

  const registerHold = useCallback(async (
    shortcut: string,
    onPress: () => void,
    onRelease: () => void,
  ): Promise<boolean> => {
    if (isGamepadShortcut(shortcut)) {
      ensurePadListener();
      if (padHandlers.has(shortcut)) {
        remember(shortcut, false);
        return false;
      }
      padHandlers.set(shortcut, (state) => {
        if (state === "Pressed") onPress();
        else onRelease();
      });
      remember(shortcut, true);
      return true;
    }
    return doRegister(shortcut, ({ state }: ShortcutTriggerState) => {
      if (state === "Pressed") onPress();
      else onRelease();
    });
  }, [doRegister]);

  const unregister = useCallback(async (shortcut: string) => {
    if (!shortcut) return;
    if (isGamepadShortcut(shortcut)) {
      padHandlers.delete(shortcut);
      const { [shortcut]: _, ...rest } = _statusCache;
      _statusCache = rest;
      emit();
      return;
    }
    if (await GlobalShortcut.isRegistered(shortcut)) await GlobalShortcut.unregister(shortcut);
    const { [shortcut]: _, ...rest } = _statusCache;
    _statusCache = rest;
    emit();
  }, []);

  const init = useCallback(async () => {
    padHandlers.clear();
    await GlobalShortcut.unregisterAll().catch(() => {});
    const s = await getAll();

    const reg = register;
    await reg(s.increaseSpeedShortcut as string, () => {
      invoke<number | null>("bridge_get_speed").then(current => {
        const next = (current ?? 1) + ((get("increaseSpeedStep") as number) || 0.5);
        invoke("bridge_set_speed", { factor: next });
        set("speed", next);
      });
    });
    await reg(s.decreaseSpeedShortcut as string, () => {
      invoke<number | null>("bridge_get_speed").then(current => {
        const next = Math.max(0.01, (current ?? 1) - ((get("decreaseSpeedStep") as number) || 0.5));
        invoke("bridge_set_speed", { factor: next });
        set("speed", next);
      });
    });
    await reg(s.resetSpeedShortcut as string, () => {
      invoke("bridge_set_speed", { factor: 1.0 });
      set("speed", 1.0);
    });
    for (let i = 1; i <= 5; i++) {
      const shortcut = s[`gear${i}Shortcut` as keyof typeof s] as string | undefined;
      if (shortcut) await reg(shortcut, () => {
        const speed = (get(`gear${i}Speed` as keyof typeof s) as number) || 1;
        invoke("bridge_set_speed", { factor: speed });
        set("speed", speed);
      });
    }

    // Hold shortcut: press → target speed, release → reset to 1.0
    const holdShortcut = s.holdShortcut as string | undefined;
    if (holdShortcut) {
      await registerHold(holdShortcut, () => {
        const hs = (get("holdSpeed") as number) || 2.0;
        invoke("bridge_set_speed", { factor: hs });
        set("speed", hs);
      }, () => {
        invoke("bridge_set_speed", { factor: 1.0 });
        set("speed", 1.0);
      });
    }
  }, [register, registerHold, set, getAll, get]);

  return { register, registerHold, unregister, init, shortcutStatus };
}
