import { useCallback } from "react";
import * as GlobalShortcut from "@tauri-apps/plugin-global-shortcut";
import { invoke } from "@tauri-apps/api/core";
import { useSettings } from "./useSettings";

type ShortcutTriggerState = {
  id: number;
  shortcut: string;
  state: "Pressed" | "Released";
};

export function useShortcut() {
  const { getAll, get, set } = useSettings();

  const register = useCallback(async (shortcut: string, callback: () => void) => {
    if (!shortcut) return;
    if (await GlobalShortcut.isRegistered(shortcut)) await GlobalShortcut.unregister(shortcut);
    await GlobalShortcut.register(shortcut, ({ state }: ShortcutTriggerState) => {
      if (state !== "Pressed") return;
      callback();
    });
  }, []);

  const registerHold = useCallback(async (
    shortcut: string,
    onPress: () => void,
    onRelease: () => void,
  ) => {
    if (!shortcut) return;
    if (await GlobalShortcut.isRegistered(shortcut)) await GlobalShortcut.unregister(shortcut);
    await GlobalShortcut.register(shortcut, ({ state }: ShortcutTriggerState) => {
      if (state === "Pressed") onPress();
      else onRelease();
    });
  }, []);

  const unregister = useCallback(async (shortcut: string) => {
    if (!shortcut) return;
    if (await GlobalShortcut.isRegistered(shortcut)) await GlobalShortcut.unregister(shortcut);
  }, []);

  const init = useCallback(async () => {
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

  return { register, registerHold, unregister, init };
}
