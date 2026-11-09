import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import i18n from "../i18n";
import {
  Box, Paper, Typography, TextField, Switch, Divider,
  Select, MenuItem, Table, TableBody, TableCell, TableHead, TableRow,
} from "@mui/material";
import ShortcutField from "./ShortcutField";
import SpeedIcon from "@mui/icons-material/Speed";
import TuneIcon from "@mui/icons-material/Tune";
import SettingsIcon from "@mui/icons-material/Settings";
import LanguageIcon from "@mui/icons-material/Language";
import PowerSettingsNewIcon from "@mui/icons-material/PowerSettingsNew";
import PushPinIcon from "@mui/icons-material/PushPin";
import ExitToAppIcon from "@mui/icons-material/ExitToApp";
import VisibilityOffIcon from "@mui/icons-material/VisibilityOff";
import { invoke } from "@tauri-apps/api/core";
import { useSettings } from "../hooks/useSettings";
import { shortcutLabel, useShortcut } from "../hooks/useShortcut";
import { useSnackbar } from "../contexts/SnackbarContext";
import { reportError } from "../utils/frontendLog";
import type { SettingsState } from "../store/settings";

// ── Helpers ───────────────────────────────────────────────────────────────

function Row({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return (
    <Box sx={{ display: "flex", alignItems: "center", py: 0.8, px: 1 }}>
      <Typography component="span" variant="body2" sx={{ flex: 1, color: "text.primary" }}>{label}</Typography>
      {children}
    </Box>
  );
}

type BootMode = "off" | "visible" | "silent";

// ── Component ─────────────────────────────────────────────────────────────

export default function SettingsManager() {
  const { t } = useTranslation();
  const { settings, get, set } = useSettings();
  const { register, registerHold, unregister, shortcutStatus } = useShortcut();
  const { notify } = useSnackbar();

  // One OS autostart entry, three modes. The backend owns both the registry
  // entry and the persisted silent flag, so the switches never disagree with
  // what actually happens at the next boot.
  const [bootMode, setBootMode] = useState<BootMode>("off");
  useEffect(() => {
    invoke<string>("get_boot_mode")
      .then(v => setBootMode((["off", "visible", "silent"].includes(v) ? v : "off") as BootMode))
      .catch(e => void reportError("autostart", "get_boot_mode failed", String(e)));
  }, []);

  async function changeBootMode(mode: BootMode) {
    try {
      await invoke<string>("set_boot_mode", { mode });
      setBootMode(mode);
      // Keep the legacy key in step for anything that still reads it.
      await set("autoStart", mode === "visible");
    } catch (e) {
      void reportError("autostart", `set_boot_mode(${mode}) failed`, String(e));
      notify(t("settings.bootModeFail"), "error");
    }
  }

  async function changeShortcut(key: keyof SettingsState, oldVal: string, newVal: string, cb: () => void) {
    if (oldVal) await unregister(oldVal).catch(() => { });
    if (newVal) {
      const ok = await register(newVal, cb).catch(() => false);
      if (ok) {
        notify(t("settings.registerSuccess", { shortcut: shortcutLabel(newVal) }), "success");
      } else {
        notify(t("settings.registerFail", { shortcut: shortcutLabel(newVal) }), "error");
      }
    }
    await set(key as keyof SettingsState, newVal);
  }

  async function changeHoldShortcut(oldVal: string, newVal: string, onPress: () => void, onRelease: () => void) {
    if (oldVal) await unregister(oldVal).catch(() => { });
    if (newVal) {
      const ok = await registerHold(newVal, onPress, onRelease).catch(() => false);
      if (ok) {
        notify(t("settings.registerSuccess", { shortcut: shortcutLabel(newVal) }), "success");
      } else {
        notify(t("settings.registerFail", { shortcut: shortcutLabel(newVal) }), "error");
      }
    }
    await set("holdShortcut", newVal);
  }

  if (!settings) {
    return <Box sx={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <Typography color="text.disabled">{t("settings.loading")}</Typography>
    </Box>;
  }

  return (
    <Box sx={{ height: "calc(100vh - 48px)", overflow: "auto", px: 1.5, pb: 2 }}>
      <Paper elevation={0} sx={{ mt: 2, p: 2, bgcolor: "background.paper", border: 1, borderColor: "divider" }}>

        {/* ── 速度快捷键 ── */}
        <Divider sx={{ my: 2 }}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            <SpeedIcon sx={{ color: "secondary.main", fontSize: 18 }} />
            <Typography variant="subtitle2" sx={{ fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5, color: "text.secondary" }}>
              {t("settings.speedShortcuts")}
            </Typography>
          </Box>
        </Divider>
        <Table size="small">
          <colgroup>
            <col />
            <col width={240} />
            <col width={80} />
          </colgroup>
          <TableHead>
            <TableRow>
              <TableCell sx={{ border: "none", textAlign: "center" }}></TableCell>
              <TableCell sx={{ border: "none", textAlign: "center" }}>{t("settings.shortcut")}</TableCell>
              <TableCell sx={{ border: "none", textAlign: "center" }}>{t("settings.step")}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            <TableRow>
              <TableCell sx={{ border: "none" }}>{t("settings.increase")}</TableCell>
              <TableCell sx={{ border: "none" }}>
                <ShortcutField value={settings.increaseSpeedShortcut} conflict={shortcutStatus[settings.increaseSpeedShortcut] === false} onChange={v => changeShortcut("increaseSpeedShortcut", settings.increaseSpeedShortcut, v, () => {
                  invoke<number | null>("bridge_get_speed").then(c => { const n = (c ?? 1) + ((get("increaseSpeedStep") as number) || 0.5); invoke("bridge_set_speed", { factor: n }); set("speed", n); });
                })} />
              </TableCell>
              <TableCell sx={{ border: "none" }}>
                <TextField type="number" size="small"
                  value={settings.increaseSpeedStep}
                  onChange={e => set("increaseSpeedStep", Number(e.target.value) || 0.1)}
                  slotProps={{ htmlInput: { min: 0.1, max: 10, step: 0.1 } }} />
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell sx={{ border: "none" }}>{t("settings.decrease")}</TableCell>
              <TableCell sx={{ border: "none" }}>
                <ShortcutField value={settings.decreaseSpeedShortcut} conflict={shortcutStatus[settings.decreaseSpeedShortcut] === false} onChange={v => changeShortcut("decreaseSpeedShortcut", settings.decreaseSpeedShortcut, v, () => {
                  invoke<number | null>("bridge_get_speed").then(c => { const n = Math.max(0.01, (c ?? 1) - ((get("decreaseSpeedStep") as number) || 0.5)); invoke("bridge_set_speed", { factor: n }); set("speed", n); });
                })} />
              </TableCell>
              <TableCell sx={{ border: "none" }}>
                <TextField type="number" size="small"
                  value={settings.decreaseSpeedStep}
                  onChange={e => set("decreaseSpeedStep", Number(e.target.value) || 0.1)}
                  sx={{ width: 80 }}
                  slotProps={{ htmlInput: { min: 0.1, max: 100, step: 0.1 } }} />
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell sx={{ border: "none" }}>{t("settings.reset")}</TableCell>
              <TableCell sx={{ border: "none" }} colSpan={1}>
                <ShortcutField value={settings.resetSpeedShortcut} conflict={shortcutStatus[settings.resetSpeedShortcut] === false} onChange={v => changeShortcut("resetSpeedShortcut", settings.resetSpeedShortcut, v, () => {
                  invoke("bridge_set_speed", { factor: 1.0 }); set("speed", 1.0);
                })} />
              </TableCell>
              <TableCell sx={{ border: "none" }}></TableCell>
            </TableRow>
          </TableBody>
        </Table>

        <Divider sx={{ my: 2 }}>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
              <TuneIcon sx={{ color: "primary.main", fontSize: 18 }} />
              <Typography variant="subtitle2" sx={{ fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5, color: "text.secondary" }}>
                {t("settings.gears")}
              </Typography>
            </Box>
          </Divider>

          {/* ── 档位设置 ── */}
          <Table size="small">
            <colgroup>
              <col />
              <col width={240} />
              <col width={80} />
            </colgroup>
            <TableHead>
              <TableRow>
                <TableCell sx={{ border: "none" }}></TableCell>
                <TableCell sx={{ border: "none" }} align="center">
                  {t("settings.shortcut")}
                </TableCell>
                <TableCell sx={{ border: "none" }} align="center">
                  {t("settings.multiplier")}
                </TableCell>
              </TableRow>
            </TableHead>
          <TableBody>
            {[1, 2, 3, 4, 5].map(gear => (
              <TableRow key={gear}>
                <TableCell sx={{ border: "none" }}>{t("settings.gear")} {gear}</TableCell>
                <TableCell sx={{ border: "none" }}>
                  <ShortcutField
                    value={settings?.[`gear${gear}Shortcut` as keyof SettingsState] as string}
                    conflict={shortcutStatus[settings?.[`gear${gear}Shortcut` as keyof SettingsState] as string] === false}
                    onChange={v => changeShortcut(`gear${gear}Shortcut` as keyof SettingsState, settings?.[`gear${gear}Shortcut` as keyof SettingsState] as string, v, () => {
                      const gs = (get(`gear${gear}Speed` as keyof SettingsState) as number) || 1;
                      invoke("bridge_set_speed", { factor: gs });
                      // Keep this in step with the startup registration in
                      // useShortcut.init(): without it the shortcut still drives
                      // the bridge, but the speed shown in the UI never moves,
                      // which reads as "the shortcut did nothing" until a
                      // restart re-registers it with the other callback.
                      set("speed", gs);
                    })}
                  />
                </TableCell>
                <TableCell sx={{ border: "none" }}>
                  <TextField type="number" size="small"
                    value={settings?.[`gear${gear}Speed` as keyof SettingsState]}
                    onChange={e => set(`gear${gear}Speed` as keyof SettingsState, Number(e.target.value) || 1)}
                    sx={{ width: 80 }}
                    slotProps={{ htmlInput: { min: 0.01, max: 100, step: 0.1 } }} />
                </TableCell>
              </TableRow>
            ))}
            {/* Hold shortcut — press to activate, release to reset */}
            <TableRow>
              <TableCell sx={{ border: "none" }}>{t("settings.hold")}</TableCell>
              <TableCell sx={{ border: "none" }}>
                <ShortcutField
                  value={settings?.holdShortcut as string}
                  conflict={shortcutStatus[settings?.holdShortcut as string] === false}
                  onChange={v => {
                    const old = settings?.holdShortcut as string;
                    changeHoldShortcut(old, v, () => {
                      const hs = (get("holdSpeed") as number) || 2.0;
                      invoke("bridge_set_speed", { factor: hs });
                      set("speed", hs);
                    }, () => {
                      invoke("bridge_set_speed", { factor: 1.0 });
                      set("speed", 1.0);
                    });
                  }}
                />
              </TableCell>
              <TableCell sx={{ border: "none" }}>
                <TextField type="number" size="small"
                  value={settings?.holdSpeed as number}
                  onChange={e => set("holdSpeed", Number(e.target.value) || 2)}
                  sx={{ width: 80 }}
                  slotProps={{ htmlInput: { min: 0.01, max: 100, step: 0.1 } }} />
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>

        <Divider sx={{ my: 2 }}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            <SettingsIcon sx={{ color: "text.secondary", fontSize: 18 }} />
            <Typography variant="subtitle2" sx={{ fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5, color: "text.secondary" }}>
              {t("settings.general")}
            </Typography>
          </Box>
        </Divider>

        {/* ── 通用设置 ── */}
        <Row label={<Box sx={{ display: "flex", alignItems: "center", gap: 0.5}}><PowerSettingsNewIcon sx={{ fontSize: 16, color: "text.secondary" }} />{t("settings.autoStart")}</Box>}>
          <Switch checked={bootMode === "visible"} onChange={(_, v) => void changeBootMode(v ? "visible" : "off")} />
        </Row>
        <Row label={<Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}><VisibilityOffIcon sx={{ fontSize: 16, color: "text.secondary" }} />{t("settings.silentAutoStart")}</Box>}>
          <Switch checked={bootMode === "silent"} onChange={(_, v) => void changeBootMode(v ? "silent" : "off")} />
        </Row>
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", px: 1, mb: 1 }}>
          {t("settings.silentAutoStartHint")}
        </Typography>
        <Row label={<Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}><PushPinIcon sx={{ fontSize: 16, color: "text.secondary" }} />{t("settings.alwaysOnTop")}</Box>}>
          <Switch checked={settings.alwaysOnTop as boolean} onChange={(_, v) => {
            set("alwaysOnTop", v);
            invoke("set_always_on_top", { onTop: v });
          }} />
        </Row>
        <Row label={<Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}><ExitToAppIcon sx={{ fontSize: 16, color: "text.secondary" }} />{t("settings.hideToTray")}</Box>}>
          <Switch checked={settings.hideToTray as boolean} onChange={(_, v) => {
            set("hideToTray", v);
          }} />
        </Row>
        <Row label={<Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}><LanguageIcon sx={{ fontSize: 16, color: "text.secondary" }} />{t("settings.language")} / Language </Box>}>
          <Select size="small" value={settings.language} onChange={e => { const lng = e.target.value as SettingsState["language"]; set("language", lng); i18n.changeLanguage(lng); }} sx={{ minWidth: 140 }}>
            <MenuItem value="zh-CN">中文（简体）</MenuItem>
            <MenuItem value="zh-TW">中文（繁體）</MenuItem>
            <MenuItem value="en-US">English</MenuItem>
            <MenuItem value="ja-JP">日本語</MenuItem>
            <MenuItem value="ko-KR">한국어</MenuItem>
            <MenuItem value="de-DE">Deutsch</MenuItem>
            <MenuItem value="fr-FR">Français</MenuItem>
            <MenuItem value="nl-NL">Nederlands</MenuItem>
            <MenuItem value="es-ES">Español</MenuItem>
            <MenuItem value="pt-BR">Português (BR)</MenuItem>
            <MenuItem value="ru-RU">Русский</MenuItem>
            <MenuItem value="hi-IN">हिन्दी</MenuItem>
          </Select>
        </Row>

      </Paper>
    </Box>
  );
}
