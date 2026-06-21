import { useEffect } from "react";
import { TrayIcon } from "@tauri-apps/api/tray";
import { Menu, MenuItem } from "@tauri-apps/api/menu";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { defaultWindowIcon } from "@tauri-apps/api/app";
import i18n from "../i18n";

export function useTray() {
  useEffect(() => {
    let tray: TrayIcon | undefined;

    (async () => {
      const window = getCurrentWindow();

      // Hide to tray instead of closing
      const unlisten = await window.onCloseRequested(async (e) => {
        e.preventDefault();
        await window.hide();
      });

      // Build i18n tray menu
      const buildMenu = async () => Menu.new({
        items: [
          await MenuItem.new({ id: "show", text: i18n.t("tray.show"), action: async () => {
            await window.unminimize();
            await window.show();
            await window.setFocus();
          }}),
          await MenuItem.new({ id: "quit", text: i18n.t("tray.quit"), action: async () => {
            await window.destroy();
          }}),
        ],
      });

      const icon = await defaultWindowIcon();
      tray = await TrayIcon.new({ icon: icon ?? undefined, menu: await buildMenu() });

      // Rebuild menu on language change
      const onLangChange = async () => { tray?.setMenu(await buildMenu()); };
      i18n.on("languageChanged", onLangChange);

      return () => {
        unlisten();
        i18n.off("languageChanged", onLangChange);
        tray?.close();
      };
    })();
  }, []);
}
