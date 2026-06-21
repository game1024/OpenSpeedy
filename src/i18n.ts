import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import zhCN from "./locales/zh-CN.json";
import zhTW from "./locales/zh-TW.json";
import jaJP from "./locales/ja-JP.json";
import koKR from "./locales/ko-KR.json";
import deDE from "./locales/de-DE.json";
import frFR from "./locales/fr-FR.json";
import enUS from "./locales/en-US.json";

i18n.use(initReactI18next).init({
  resources: {
    "zh-CN": { translation: zhCN },
    "zh-TW": { translation: zhTW },
    "ja-JP": { translation: jaJP },
    "ko-KR": { translation: koKR },
    "de-DE": { translation: deDE },
    "fr-FR": { translation: frFR },
    "en-US": { translation: enUS },
  },
  lng: "zh-CN",
  fallbackLng: "zh-CN",
  interpolation: { escapeValue: false },
});

// Sync language from persisted settings on startup
(async () => {
  const { load } = await import("@tauri-apps/plugin-store");
  const store = await load("settings.json");
  const saved = await store.get<{ language?: string }>("settings");
  if (saved?.language && saved.language !== i18n.language) {
    i18n.changeLanguage(saved.language);
  }
})();

export default i18n;
