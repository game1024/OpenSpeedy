import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import i18n from "../i18n";
import {
  Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, Paper, Typography, TextField, Switch, Divider, Tooltip,
  Select, MenuItem, Table, TableBody, TableCell, TableHead, TableRow,
} from "@mui/material";
import ClearIcon from "@mui/icons-material/Clear";
import ShortcutField from "./ShortcutField";
import ShortcutProfileDialog from "./ShortcutProfileDialog";
import SpeedIcon from "@mui/icons-material/Speed";
import TuneIcon from "@mui/icons-material/Tune";
import SettingsIcon from "@mui/icons-material/Settings";
import LanguageIcon from "@mui/icons-material/Language";
import PowerSettingsNewIcon from "@mui/icons-material/PowerSettingsNew";
import PushPinIcon from "@mui/icons-material/PushPin";
import ExitToAppIcon from "@mui/icons-material/ExitToApp";
import { invoke } from "@tauri-apps/api/core";
import { enable, disable, isEnabled } from "@tauri-apps/plugin-autostart";
import { useSettings } from "../hooks/useSettings";
import { shortcutLabel, shortcutRegistered, syncShortcuts, useShortcut } from "../hooks/useShortcut";
import { useSnackbar } from "../contexts/SnackbarContext";
import { reportError } from "../utils/frontendLog";
import type { SettingsState } from "../store/settings";
import { loadShortcutProfiles, saveShortcutProfiles } from "../store/settings";
import {
  deleteProfile, exeKey, globalShortcuts, newlyAddedExes, previewShortcuts, profilesOverriding, profilesOverridingValue,
  SPEED_VALUE_BOUNDS, upsertProfile,
  type ShortcutProfile, type ShortcutSlot, type SpeedValueKey,
} from "../shortcutProfile";

// ── Helpers ───────────────────────────────────────────────────────────────

function Row({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return (
    <Box sx={{ display: "flex", alignItems: "center", py: 0.8, px: 1 }}>
      <Typography component="span" variant="body2" sx={{ flex: 1, color: "text.primary" }}>{label}</Typography>
      {children}
    </Box>
  );
}

// ── Component ─────────────────────────────────────────────────────────────

export default function SettingsManager() {
  const { t } = useTranslation();
  const profileNameSep = t("settings.profileNameSeparator");
  const { settings, set } = useSettings();
  const { shortcutStatus } = useShortcut();
  const { notify } = useSnackbar();
  const [profiles, setProfiles] = useState<ShortcutProfile[]>([]);
  const [selectedId, setSelectedId] = useState("global");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Sync auto-start state from system on mount. Reported rather than swallowed:
  // these three calls are gated by the capability file, so a missing permission
  // fails here and the only symptom is a switch that does nothing.
  useEffect(() => {
    isEnabled()
      .then(v => set("autoStart", v))
      .catch(e => void reportError("autostart", "isEnabled failed", String(e)));
    loadShortcutProfiles().then(setProfiles).catch(e => void reportError("settings", "load profiles failed", String(e)));
  }, []);

  if (!settings) {
    return <Box sx={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <Typography color="text.disabled">{t("settings.loading")}</Typography>
    </Box>;
  }

  const current = settings;
  const profile = profiles.find(item => item.id === selectedId) ?? null;

  function numberCell(key: SpeedValueKey, fallback: number) {
    const [min, max] = SPEED_VALUE_BOUNDS[key];
    const pinned = profile?.values?.[key];
    const inheriting = !!profile && pinned === undefined;
    const raw = profile ? (pinned ?? current[key]) : current[key];
    const shown = typeof raw === "number" ? raw : fallback;
    const names = profile ? [] : profilesOverridingValue(profiles, key);
    return (
      <Box>
        <Box sx={{ display: "flex", alignItems: "center" }}>
          <TextField type="number" size="small" value={shown}
            onChange={e => {
              const n = Number(e.target.value);
              if (!profile) {
                void set(key, n || fallback);
                return;
              }
              if (!Number.isFinite(n) || n < min || n > max) return;
              void persistProfiles(
                upsertProfile(profiles, { ...profile, values: { ...profile.values, [key]: n } }),
                profile.id,
              );
            }}
            sx={{ width: 80, ...(inheriting ? { "& .MuiInputBase-input": { color: "text.disabled" } } : {}) }}
            slotProps={{ htmlInput: { min, max, step: 0.1 } }} />
          {profile && pinned !== undefined && (
            <IconButton size="small" onClick={() => {
              const values = { ...profile.values };
              delete values[key];
              void persistProfiles(upsertProfile(profiles, { ...profile, values }), profile.id);
            }}>
              <ClearIcon sx={{ fontSize: "1rem", color: "text.secondary" }} />
            </IconButton>
          )}
        </Box>
        {inheriting && <Typography variant="caption" color="text.disabled">{t("shortcut.inherited")}</Typography>}
        {overrideNote(names)}
      </Box>
    );
  }

  function overrideNote(names: string[]) {
    if (names.length === 0) return null;
    return (
      <Tooltip title={t("settings.profileOverridden", { names: names.join(profileNameSep) })}>
        <Typography component="span" variant="caption" color="text.disabled" sx={{ display: "block", mt: 0.3, width: "fit-content" }}>
          {t("settings.profileOverriddenShort")}
        </Typography>
      </Tooltip>
    );
  }

  async function persistProfiles(next: ShortcutProfile[], select: string) {
    const added = newlyAddedExes(profiles, next);
    setProfiles(next);
    setSelectedId(select);
    await saveShortcutProfiles(next);
    await syncShortcuts();
    await enableRunning(added);
  }

  /** Turn matching processes on once. Does not remember the name, so the switch can be turned off later. */
  async function enableRunning(names: string[]) {
    if (names.length === 0) return;
    const wanted = new Set(names.map(exeKey));
    const list = await invoke<{ pid: number; name: string; arch: string }[]>("get_process_list_fast").catch(() => []);
    for (const proc of list) {
      if (!wanted.has(exeKey(proc.name))) continue;
      invoke("bridge_inject", { pid: proc.pid, arch: proc.arch }).catch(() => {});
    }
  }

  async function saveSlot(slot: ShortcutSlot, value: string) {
    if (profile) {
      const shortcuts = { ...profile.shortcuts };
      if (value) shortcuts[slot] = value;
      else if (shortcuts[slot]) delete shortcuts[slot];
      else shortcuts[slot] = "";
      await persistProfiles(upsertProfile(profiles, { ...profile, shortcuts }), profile.id);
    } else {
      await set(slot, value);
      await syncShortcuts();
    }
    // A profile key is only registered while its process is in the foreground, so there is nothing to report yet.
    const ok = value ? shortcutRegistered(value) : undefined;
    if (ok === undefined) return;
    const label = shortcutLabel(value);
    notify(
      ok === false
        ? t("settings.registerFail", { shortcut: label })
        : t("settings.registerSuccess", { shortcut: label }),
      ok === false ? "error" : "success",
    );
  }

  function restoreSlot(slot: ShortcutSlot) {
    if (!profile) return;
    const shortcuts = { ...profile.shortcuts };
    delete shortcuts[slot];
    void persistProfiles(upsertProfile(profiles, { ...profile, shortcuts }), profile.id);
  }

  function cell(slot: ShortcutSlot) {
    const raw = profile ? profile.shortcuts[slot] : undefined;
    const muted = raw === "";
    const stored = profile ? (raw ?? "") : String(current[slot] ?? "");
    const preview = previewShortcuts(globalShortcuts(current), profile ? profile.shortcuts : null);
    const effective = preview.shortcuts[slot];
    const overridden = profile ? [] : profilesOverriding(profiles, slot);
    return (
      <Box>
        <ShortcutField
          value={stored}
          inheritFrom={profile && raw === undefined ? String(current[slot] ?? "") : undefined}
          muted={muted}
          onRestore={muted ? () => restoreSlot(slot) : undefined}
          conflict={preview.conflicts.includes(slot) || shortcutStatus[effective] === false}
          onChange={v => { void saveSlot(slot, v); }}
        />
        {overrideNote(overridden)}
      </Box>
    );
  }

  return (
    <Box sx={{ height: "calc(100vh - 48px)", overflow: "auto", px: 1.5, pb: 2 }}>
      <Paper elevation={0} sx={{ mt: 2, p: 2, bgcolor: "background.paper", border: 1, borderColor: "divider" }}>
        <Row label={t("settings.profile")}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            <Select
              size="small"
              value={profile ? profile.id : "global"}
              onChange={e => setSelectedId(e.target.value)}
              sx={{
                minWidth: 140,
                maxWidth: 240,
                "& .MuiSelect-select": { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "block" },
              }}
            >
              <MenuItem value="global">{t("settings.profileGlobal")}</MenuItem>
              {profiles.map(item => (
                <MenuItem key={item.id} value={item.id} sx={{ maxWidth: 320 }}>
                  <Typography noWrap sx={{ fontSize: "inherit" }}>{item.name}</Typography>
                </MenuItem>
              ))}
            </Select>
            {profile ? (
              <>
                <Button size="small" onClick={() => setDialogOpen(true)}>{t("settings.profileEdit")}</Button>
                <Button size="small" color="error" onClick={() => setConfirmDelete(true)}>{t("settings.profileDelete")}</Button>
              </>
            ) : (
              <Button size="small" onClick={() => setDialogOpen(true)}>{t("settings.profileNew")}</Button>
            )}
          </Box>
        </Row>
        {profile && (
          <Box sx={{ px: 1, pb: 0.5 }}>
            <Typography variant="body2" color="text.secondary">
              {t("settings.profileProcesses")}　{profile.processes.join(profileNameSep)}
            </Typography>
            <Typography variant="caption" color="text.disabled" sx={{ display: "block" }}>{t("settings.profileWhenForeground")}</Typography>
          </Box>
        )}

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
            <col width={120} />
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
              <TableCell sx={{ border: "none" }}>{cell("increaseSpeedShortcut")}</TableCell>
              <TableCell sx={{ border: "none" }}>{numberCell("increaseSpeedStep", 0.1)}</TableCell>
            </TableRow>
            <TableRow>
              <TableCell sx={{ border: "none" }}>{t("settings.decrease")}</TableCell>
              <TableCell sx={{ border: "none" }}>{cell("decreaseSpeedShortcut")}</TableCell>
              <TableCell sx={{ border: "none" }}>{numberCell("decreaseSpeedStep", 0.1)}</TableCell>
            </TableRow>
            <TableRow>
              <TableCell sx={{ border: "none" }}>{t("settings.reset")}</TableCell>
              <TableCell sx={{ border: "none" }} colSpan={1}>{cell("resetSpeedShortcut")}</TableCell>
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
              <col width={120} />
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
                <TableCell sx={{ border: "none" }}>{cell(`gear${gear}Shortcut` as ShortcutSlot)}</TableCell>
                <TableCell sx={{ border: "none" }}>{numberCell(`gear${gear}Speed` as SpeedValueKey, 1)}</TableCell>
              </TableRow>
            ))}
            {/* Hold shortcut — press to activate, release to reset */}
            <TableRow>
              <TableCell sx={{ border: "none" }}>{t("settings.hold")}</TableCell>
              <TableCell sx={{ border: "none" }}>{cell("holdShortcut")}</TableCell>
              <TableCell sx={{ border: "none" }}>{numberCell("holdSpeed", 2)}</TableCell>
            </TableRow>
          </TableBody>
        </Table>

        {!profile && (
          <>
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
          <Switch checked={settings.autoStart} onChange={async (_, v) => {
            try {
              if (v) await enable(); else await disable();
              set("autoStart", v);
            } catch (e) {
              // Leave the setting alone so the switch keeps showing what the
              // system actually has, and say which call failed.
              void reportError("autostart", v ? "enable failed" : "disable failed", String(e));
            }
          }} />
        </Row>
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
          </>
        )}

        <ShortcutProfileDialog
          open={dialogOpen}
          profiles={profiles}
          initial={profile}
          onCancel={() => setDialogOpen(false)}
          onSave={next => {
            setDialogOpen(false);
            void persistProfiles(upsertProfile(profiles, next), next.id);
          }}
        />
        <Dialog open={confirmDelete} onClose={() => setConfirmDelete(false)}>
          <DialogTitle>{t("settings.profileDeleteTitle")}</DialogTitle>
          <DialogContent>
            <Typography variant="body2" sx={{ wordBreak: "break-all" }}>{t("settings.profileDeleteAsk", { name: profile?.name ?? "" })}</Typography>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setConfirmDelete(false)}>{t("settings.profileCancel")}</Button>
            <Button color="error" onClick={() => {
              if (!profile) return;
              setConfirmDelete(false);
              void persistProfiles(deleteProfile(profiles, profile.id), "global");
            }}>{t("settings.profileDelete")}</Button>
          </DialogActions>
        </Dialog>

      </Paper>
    </Box>
  );
}
