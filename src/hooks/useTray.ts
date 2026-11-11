import { useEffect } from "react";
import { TrayIcon, type TrayIconEvent } from "@tauri-apps/api/tray";
import { Menu } from "@tauri-apps/api/menu";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { defaultWindowIcon } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import i18n, { languageReady } from "../i18n";
import { getSetting } from "../store/settings";
import { reportError } from "../utils/frontendLog";

const TRAY_ID = "main";

/**
 * Whether the window's close button should tuck the app away in the tray
 * rather than end it. An unreadable store falls back to hiding, which is the
 * behaviour that cannot lose the user's session.
 */
const closeHidesToTray = async () => {
  try {
    // `!== false` rather than a truthiness check, so a value that never made it
    // into the store still lands on the default.
    return (await getSetting("hideToTray")) !== false;
  } catch (e) {
    console.error("could not read the hideToTray setting", e);
    return true;
  }
};

/** Bring the main window back, whether it was hidden or minimised. */
const showWindow = async () => {
  const window = getCurrentWindow();
  await window.unminimize();
  await window.show();
  await window.setFocus();
};

// The tray lives outside the React tree, so it never re-renders on its own —
// the menu is rebuilt from the *current* i18n language at each call site.
const buildMenu = () => {
  const window = getCurrentWindow();
  // Plain options, not `MenuItem` instances: the backend creates the items in
  // one call, so a failure cannot leave a half-built menu behind.
  return Menu.new({
    items: [
      { id: "show", text: i18n.t("tray.show"), action: showWindow },
      // Reachable even when the main window never appeared — a user whose
      // app fails to start can still get at the log from here.
      { id: "logs", text: i18n.t("tray.logs"), action: async () => {
        await revealItemInDir(await invoke<string>("get_log_path"));
      }},
      { id: "quit", text: i18n.t("tray.quit"), action: async () => {
        await window.destroy();
      }},
    ],
  });
};

/**
 * A left click on the tray icon surfaces the window instead of opening the
 * menu; right click still opens it, which is the Windows convention.
 *
 * The event fires for every button, both button states, and for hover and
 * move as well, so only the left button's release acts — the same edge the
 * default menu would have opened on.
 */
const onTrayEvent = (event: TrayIconEvent) => {
  if (event.type !== "Click" || event.button !== "Left" || event.buttonState !== "Up") {
    return;
  }
  void showWindow();
};

let trayPromise: Promise<TrayIcon | null> | null = null;

/** The tray icon, created on first use. Resolves `null` if creating it failed. */
const tray = () => trayPromise ??= (async (): Promise<TrayIcon | null> => {
  // Wait for the startup language before the first build: on a first run the
  // settings file still has to be created, and an English menu built and then
  // never rebuilt is exactly the bug this avoids.
  await languageReady;
  try {
    const icon = await defaultWindowIcon();
    return await TrayIcon.new({
      id: TRAY_ID,
      icon: icon ?? undefined,
      menu: await buildMenu(),
      // Left click shows the window rather than dropping the menu under the
      // cursor. Right click is a separate flag and still opens it.
      showMenuOnLeftClick: false,
      action: onTrayEvent,
    });
  } catch (e) {
    // Without a tray the app is still usable, just without the "open log"
    // entry point — fail soft.
    console.error("failed to create the tray icon", e);
    return null;
  }
})();

/** Re-render the menu in the current language. A no-op if the tray never came up. */
const rebuildMenu = async () => {
  const icon = await tray();
  if (!icon) return;
  try {
    icon.setMenu(await buildMenu());
  } catch (e) {
    console.error("failed to rebuild the tray menu", e);
  }
};

export function useTray() {
  useEffect(() => {
    const window = getCurrentWindow();
    let live = true;
    let unlistenClose: (() => void) | undefined;

    void (async () => {
      // Hide to tray instead of closing, unless the user turned that off. Read
      // at click time so the setting applies without a restart, and read
      // straight from the store rather than a rendered value, so this does not
      // depend on when the cache happened to load.
      const unlisten = await window.onCloseRequested(async (e) => {
        e.preventDefault();
        if (await closeHidesToTray()) {
          await window.hide();
          return;
        }
        // Same path as the tray's quit item, so the exit (and the bridge
        // cleanup it triggers) behaves identically.
        await window.destroy();
      });
      if (live) unlistenClose = unlisten;
      else unlisten();
    })().catch(e => void reportError("tray", "onCloseRequested failed", String(e)));

    i18n.on("languageChanged", rebuildMenu);
    return () => {
      live = false;
      unlistenClose?.();
      // The tray itself outlives this component on purpose: closing the window
      // hides it, so the app only ever ends through the tray's own quit item.
      i18n.off("languageChanged", rebuildMenu);
    };
  }, []);
}
