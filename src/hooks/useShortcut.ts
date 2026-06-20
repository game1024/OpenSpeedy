import { useCallback } from "react";
import * as GlobalShortcut from "@tauri-apps/plugin-global-shortcut";
import { invoke } from "@tauri-apps/api/core";
import { loadSettings } from "../store/settings";
import { useSettings } from "./useSettings";

type ShortcutTriggerState = {
  id: number;
  shortcut: string;
  state: "Pressed" | "Released";
};

export function useShortcut() {
  const { set } = useSettings();

  const register = useCallback(async (shortcut: string, callback: () => void) => {
    if (!shortcut) return;
    if (await GlobalShortcut.isRegistered(shortcut)) await GlobalShortcut.unregister(shortcut);
    await GlobalShortcut.register(shortcut, ({ state }: ShortcutTriggerState) => {
      if (state !== "Pressed") return;
      callback();
    });
  }, []);

  const unregister = useCallback(async (shortcut: string) => {
    if (!shortcut) return;
    if (await GlobalShortcut.isRegistered(shortcut)) await GlobalShortcut.unregister(shortcut);
  }, []);

  const init = useCallback(async () => {
    await GlobalShortcut.unregisterAll().catch(() => {});
    const s = await loadSettings();

    const reg = register;
    await reg(s.increaseSpeedShortcut as string, () => {
      invoke<number | null>("bridge_get_speed").then(current => {
        const next = (current ?? 1) + ((s.increaseSpeedStep as number) || 0.5);
        invoke("bridge_set_speed", { factor: next });
        set("speed", next);
      });
    });
    await reg(s.decreaseSpeedShortcut as string, () => {
      invoke<number | null>("bridge_get_speed").then(current => {
        const next = Math.max(0.01, (current ?? 1) - ((s.decreaseSpeedStep as number) || 0.5));
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
      const speed = (s[`gear${i}Speed` as keyof typeof s] as number) || 1;
      if (shortcut) await reg(shortcut, () => {
        invoke("bridge_set_speed", { factor: speed });
        set("speed", speed);
      });
    }
  }, [register, set]);

  return { register, unregister, init };
}
