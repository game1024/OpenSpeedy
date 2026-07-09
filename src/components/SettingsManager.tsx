import { useEffect } from "react";
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
import { invoke } from "@tauri-apps/api/core";
import { enable, disable, isEnabled } from "@tauri-apps/plugin-autostart";
import { useSettings } from "../hooks/useSettings";
import { useShortcut } from "../hooks/useShortcut";
import { useSnackbar } from "../contexts/SnackbarContext";
import type { SettingsState } from "../store/settings";

// ── Helpers ───────────────────────────────────────────────────────────────

function Row({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return (
    <Box sx={{ display: "flex", alignItems: "center", py: 0.8, px: 1, "&:not(:last-child)": { borderBottom: 1, borderColor: "divider" } }}>
      <Typography component="span" variant="body2" sx={{ flex: 1, color: "text.primary" }}>{label}</Typography>
      {children}
    </Box>
  );
}

// ── Component ─────────────────────────────────────────────────────────────

export default function SettingsManager() {
  const { t } = useTranslation();
  const { settings, get, set } = useSettings();
  const { register, registerHold, unregister } = useShortcut();
  const { notify } = useSnackbar();

  // Sync auto-start state from system on mount
  useEffect(() => { isEnabled().then(v => set("autoStart", v)).catch(() => { }); }, []);

  async function changeShortcut(key: keyof SettingsState, oldVal: string, newVal: string, cb: () => void) {
    if (oldVal) await unregister(oldVal).catch(() => { });
    if (newVal) {
      try {
        await register(newVal, cb);
        notify(t("settings.registerSuccess", { shortcut: newVal }), "success");
      } catch {
        notify(t("settings.registerFail", { shortcut: newVal }), "error");
      }
    }
    await set(key as keyof SettingsState, newVal);
  }

  async function changeHoldShortcut(oldVal: string, newVal: string, onPress: () => void, onRelease: () => void) {
    if (oldVal) await unregister(oldVal).catch(() => { });
    if (newVal) {
      try {
        await registerHold(newVal, onPress, onRelease);
        notify(t("settings.registerSuccess", { shortcut: newVal }), "success");
      } catch {
        notify(t("settings.registerFail", { shortcut: newVal }), "error");
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
        <Table size="small">
          <colgroup>
            <col />
            <col width={240} />
            <col width={80} />
          </colgroup>
          <TableHead>
            <TableRow>
              <TableCell>
                <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                  <SpeedIcon sx={{ color: "secondary.main", fontSize: 18 }} />
                  <Typography variant="subtitle2" sx={{ fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5, color: "text.secondary" }}>
                    {t("settings.speedShortcuts")}
                  </Typography>
                </Box>
              </TableCell>
              <TableCell>{t("settings.shortcut")}</TableCell>
              <TableCell>{t("settings.step")}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            <TableRow>
              <TableCell sx={{ borderBottom: "none" }}>{t("settings.increase")}</TableCell>
              <TableCell sx={{ borderBottom: "none" }}>
                <ShortcutField value={settings.increaseSpeedShortcut} onChange={v => changeShortcut("increaseSpeedShortcut", settings.increaseSpeedShortcut, v, () => {
                  invoke<number | null>("bridge_get_speed").then(c => { const n = (c ?? 1) + ((get("increaseSpeedStep") as number) || 0.5); invoke("bridge_set_speed", { factor: n }); set("speed", n); });
                })} />
              </TableCell>
              <TableCell sx={{ borderBottom: "none" }}>
                <TextField type="number" size="small"
                  value={settings.increaseSpeedStep}
                  onChange={e => set("increaseSpeedStep", Number(e.target.value) || 0.1)}
                  slotProps={{ htmlInput: { min: 0.1, max: 10, step: 0.1 } }} />
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell sx={{ borderBottom: "none" }}>{t("settings.decrease")}</TableCell>
              <TableCell sx={{ borderBottom: "none" }}>
                <ShortcutField value={settings.decreaseSpeedShortcut} onChange={v => changeShortcut("decreaseSpeedShortcut", settings.decreaseSpeedShortcut, v, () => {
                  invoke<number | null>("bridge_get_speed").then(c => { const n = Math.max(0.01, (c ?? 1) - ((get("decreaseSpeedStep") as number) || 0.5)); invoke("bridge_set_speed", { factor: n }); set("speed", n); });
                })} />
              </TableCell>
              <TableCell sx={{ borderBottom: "none" }}>
                <TextField type="number" size="small"
                  value={settings.decreaseSpeedStep}
                  onChange={e => set("decreaseSpeedStep", Number(e.target.value) || 0.1)}
                  sx={{ width: 80 }}
                  slotProps={{ htmlInput: { min: 0.1, max: 100, step: 0.1 } }} />
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell sx={{ borderBottom: "none" }}>{t("settings.reset")}</TableCell>
              <TableCell sx={{ borderBottom: "none" }} colSpan={1}>
                <ShortcutField value={settings.resetSpeedShortcut} onChange={v => changeShortcut("resetSpeedShortcut", settings.resetSpeedShortcut, v, () => {
                  invoke("bridge_set_speed", { factor: 1.0 }); set("speed", 1.0);
                })} />
              </TableCell>
              <TableCell sx={{ borderBottom: "none" }}></TableCell>
            </TableRow>
          </TableBody>
        </Table>

        <Divider sx={{ mb: 2 }} />

        {/* ── 档位设置 ── */}
        <Table size="small">
          <colgroup>
            <col />
            <col width={240} />
            <col width={80} />
          </colgroup>
          <TableHead>
            <TableRow>
              <TableCell>
                <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                  <TuneIcon sx={{ color: "primary.main", fontSize: 18 }} />
                  <Typography variant="subtitle2" sx={{ fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5, color: "text.secondary" }}>
                    {t("settings.gears")}
                  </Typography>
                </Box> </TableCell>
              <TableCell>{t("settings.shortcut")}</TableCell>
              <TableCell>{t("settings.multiplier")}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {[1, 2, 3, 4, 5].map(gear => (
              <TableRow key={gear}>
                <TableCell sx={{ borderBottom: "none" }}>{t("settings.gear")} {gear}</TableCell>
                <TableCell sx={{ borderBottom: "none" }}>
                  <ShortcutField
                    value={settings?.[`gear${gear}Shortcut` as keyof SettingsState] as string}
                    onChange={v => changeShortcut(`gear${gear}Shortcut` as keyof SettingsState, settings?.[`gear${gear}Shortcut` as keyof SettingsState] as string, v, () => {
                      const gs = (get(`gear${gear}Speed` as keyof SettingsState) as number) || 1;
                      invoke("bridge_set_speed", { factor: gs });
                    })}
                  />
                </TableCell>
                <TableCell sx={{ borderBottom: "none" }}>
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
              <TableCell sx={{ borderBottom: "none" }}>{t("settings.hold")}</TableCell>
              <TableCell sx={{ borderBottom: "none" }}>
                <ShortcutField
                  value={settings?.holdShortcut as string}
                  onChange={v => {
                    const old = settings?.holdShortcut as string;
                    const hs = (get("holdSpeed") as number) || 2.0;
                    changeHoldShortcut(old, v, () => {
                      invoke("bridge_set_speed", { factor: hs });
                      set("speed", hs);
                    }, () => {
                      invoke("bridge_set_speed", { factor: 1.0 });
                      set("speed", 1.0);
                    });
                  }}
                />
              </TableCell>
              <TableCell sx={{ borderBottom: "none" }}>
                <TextField type="number" size="small"
                  value={settings?.holdSpeed as number}
                  onChange={e => set("holdSpeed", Number(e.target.value) || 2)}
                  sx={{ width: 80 }}
                  slotProps={{ htmlInput: { min: 0.01, max: 100, step: 0.1 } }} />
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>

        <Divider sx={{ mb: 2 }} />

        {/* ── 通用设置 ── */}
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 0.5, mt: 2 }}>
          <SettingsIcon sx={{ color: "text.secondary", fontSize: 18 }} />
          <Typography variant="subtitle2" sx={{ fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5, color: "text.secondary" }}>
            {t("settings.general")}
          </Typography>
        </Box>
        <Row label={<Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}><PowerSettingsNewIcon sx={{ fontSize: 16, color: "text.secondary" }} />{t("settings.autoStart")}</Box>}>
          <Switch checked={settings.autoStart} onChange={async (_, v) => {
            if (v) await enable(); else await disable();
            set("autoStart", v);
          }} />
        </Row>
        <Row label={<Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}><PushPinIcon sx={{ fontSize: 16, color: "text.secondary" }} />{t("settings.alwaysOnTop")}</Box>}>
          <Switch checked={settings.alwaysOnTop as boolean} onChange={(_, v) => {
            set("alwaysOnTop", v);
            invoke("set_always_on_top", { onTop: v });
          }} />
        </Row>
        <Row label={<Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}><LanguageIcon sx={{ fontSize: 16, color: "text.secondary" }} />{t("settings.language")}</Box>}>
          <Select size="small" value={settings.language} onChange={e => { const lng = e.target.value as "zh-CN" | "en-US"; set("language", lng); i18n.changeLanguage(lng); }} sx={{ minWidth: 100 }}>
            <MenuItem value="zh-CN">中文（简体）</MenuItem>
            <MenuItem value="zh-TW">中文（繁體）</MenuItem>
            <MenuItem value="ja-JP">日本語</MenuItem>
            <MenuItem value="ko-KR">한국어</MenuItem>
            <MenuItem value="de-DE">Deutsch</MenuItem>
            <MenuItem value="fr-FR">Français</MenuItem>
            <MenuItem value="en-US">English</MenuItem>
          </Select>
        </Row>

      </Paper>
    </Box>
  );
}
