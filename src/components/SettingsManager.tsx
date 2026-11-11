import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { keyframes } from "@emotion/react";
import i18n from "../i18n";
import {
  Alert, Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, Paper, Typography, TextField, Switch, Divider, Tooltip,
  Select, MenuItem, Table, TableBody, TableCell, TableHead, TableRow, useMediaQuery,
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
import SportsEsportsIcon from "@mui/icons-material/SportsEsports";
import LinkIcon from "@mui/icons-material/Link";
import VisibilityOffIcon from "@mui/icons-material/VisibilityOff";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import PublicIcon from "@mui/icons-material/Public";
import WindowIcon from "@mui/icons-material/Window";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { enable, disable, isEnabled } from "@tauri-apps/plugin-autostart";
import { useSettings } from "../hooks/useSettings";
import { shortcutLabel, shortcutRegistered, syncShortcuts, useShortcut } from "../hooks/useShortcut";
import { useSnackbar } from "../contexts/SnackbarContext";
import { reportError } from "../utils/frontendLog";
import type { SettingsState } from "../store/settings";
import { loadShortcutProfiles, saveShortcutProfiles } from "../store/settings";
import { isReservedCombo } from "../shortcutGuard";
import {
  deleteProfile, exeBase, exeKey, globalShortcuts, newlyAddedExes, previewShortcuts, profilesOverriding, profilesOverridingValue,
  SHORTCUT_SLOTS, SPEED_VALUE_BOUNDS, upsertProfile,
  type ShortcutProfile, type ShortcutSlot, type SpeedValueKey,
} from "../shortcutProfile";

// Ripple for the “active” chip, so an in-effect profile is visible at a
// glance. Stops entirely under prefers-reduced-motion.
const activePulse = keyframes`
  0%, 100% { box-shadow: 0 0 0 0 rgba(102, 187, 106, 0.75); }
  50% { box-shadow: 0 0 0 7px rgba(102, 187, 106, 0); }
`;

/** Mirrors `remote::RemoteInfo` on the Rust side. */
interface RemoteInfo {
  enabled: boolean;
  url: string;
  token: string;
}

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
  // Rust reports which exe owns the foreground window; used to show which
  // configuration is actually in effect right now.
  const [foreground, setForeground] = useState("");
  // The local control page (stage 6): address and session token.
  const [remote, setRemote] = useState<RemoteInfo>({ enabled: false, url: "", token: "" });

  // Sync auto-start state from system on mount. Reported rather than swallowed:
  // these three calls are gated by the capability file, so a missing permission
  // fails here and the only symptom is a switch that does nothing.
  useEffect(() => {
    isEnabled()
      .then(v => set("autoStart", v))
      .catch(e => void reportError("autostart", "isEnabled failed", String(e)));
    loadShortcutProfiles().then(setProfiles).catch(e => void reportError("settings", "load profiles failed", String(e)));
    invoke<string>("foreground_exe_name").then(setForeground).catch(() => {});
    invoke<RemoteInfo>("remote_info").then(setRemote).catch(() => {});
    let stop: (() => void) | undefined;
    let dead = false;
    listen<string>("foreground-changed", event => {
      if (typeof event.payload === "string") setForeground(event.payload);
    }).then(unlisten => {
      if (dead) unlisten();
      else stop = unlisten;
    }).catch(e => void reportError("settings", "foreground listener failed", String(e)));
    return () => { dead = true; stop?.(); };
  }, []);

  if (!settings) {
    return <Box sx={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <Typography color="text.disabled">{t("settings.loading")}</Typography>
    </Box>;
  }

  const current = settings;
  const profile = profiles.find(item => item.id === selectedId) ?? null;
  const foregroundKey = exeKey(foreground);
  const activeProfile = foregroundKey
    ? profiles.find(item => item.processes.some(proc => exeKey(proc) === foregroundKey)) ?? null
    : null;
  // Below this width the sidebar would leave too little room for the tables.
  const wide = useMediaQuery("(min-width: 720px)");

  // Chords the OS refused, so the failure is visible without scanning every
  // field. Only the global table is unconditional, so profiles are excluded.
  const failedGlobal = SHORTCUT_SLOTS.filter(target => {
    const chord = String(current[target] ?? "");
    return !!chord && shortcutStatus[chord] === false;
  });

  function profileItem({ key, icon, label, selected, active, onClick }: {
    key?: string;
    icon?: React.ReactNode;
    label: string;
    selected: boolean;
    active: boolean;
    onClick: () => void;
  }) {
    return (
      <Box key={key} onClick={onClick} sx={{
        px: 1.5, py: 0.9, cursor: "pointer",
        borderLeft: 3,
        borderColor: selected ? "secondary.main" : "transparent",
        bgcolor: selected ? "action.selected" : "transparent",
        "&:hover": { bgcolor: selected ? "action.selected" : "action.hover" },
      }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
          {icon}
          <Typography variant="body2" noWrap sx={{ flex: 1, fontSize: "0.92rem", fontWeight: selected ? 700 : 600 }}>{label}</Typography>
          {active && (
            <Chip
              size="small"
              color="success"
              label={t("settings.profileActiveNow")}
              sx={{
                height: 18,
                fontSize: "0.62rem",
                flexShrink: 0,
                "& .MuiChip-label": { px: 0.75 },
                animation: `${activePulse} 1.6s ease-in-out infinite`,
                "@media (prefers-reduced-motion: reduce)": { animation: "none" },
              }}
            />
          )}
        </Box>
      </Box>
    );
  }

  const profileSelect = (
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
  );

  function numberCell(key: SpeedValueKey, fallback: number) {
    const [min, max] = SPEED_VALUE_BOUNDS[key];
    const pinned = profile?.values?.[key];
    const inheriting = !!profile && pinned === undefined;
    const raw = profile ? (pinned ?? current[key]) : current[key];
    const shown = typeof raw === "number" ? raw : fallback;
    const input = (
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
    );
    return (
      <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
        {input}
        {profile && pinned !== undefined && (
          <IconButton size="small" onClick={() => {
            const values = { ...profile.values };
            delete values[key];
            void persistProfiles(upsertProfile(profiles, { ...profile, values }), profile.id);
          }}>
            <ClearIcon sx={{ fontSize: "1rem", color: "text.secondary" }} />
          </IconButton>
        )}
        {inheriting && (
          <Typography variant="caption" color="text.disabled" sx={{ whiteSpace: "nowrap" }}>
            {t("shortcut.inherited")}
          </Typography>
        )}
      </Box>
    );
  }

  /** Profile names overriding any of the given slots/values, in the global view only. */
  function overridesFor(slots: ShortcutSlot[], values: SpeedValueKey[] = []): string[] {
    if (profile) return [];
    return [
      ...slots.flatMap(slot => profilesOverriding(profiles, slot)),
      ...values.flatMap(key => profilesOverridingValue(profiles, key)),
    ];
  }

  // The hint lives on the row label: hovering the setting's name explains
  // which profiles override it, without taking space from the control.
  function labelCell(label: React.ReactNode, names: string[]) {
    const unique = [...new Set(names)];
    return (
      <TableCell sx={{ border: "none" }}>
        {unique.length === 0 ? label : (
          <Tooltip title={t("settings.profileOverridden", { names: unique.join(profileNameSep) })}>
            <Box component="span" sx={{
              cursor: "help",
              textDecoration: "underline dotted",
              textDecorationColor: "text.disabled",
              textUnderlineOffset: 2,
            }}>
              {label}
            </Box>
          </Tooltip>
        )}
      </TableCell>
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
    let refused = 0;
    for (const proc of list) {
      if (!wanted.has(exeKey(proc.name))) continue;
      // Same guard the manual switch uses: a profile must not become a way to
      // reach a protected game without a word.
      const verdict = await invoke<{ allowed: boolean }>("injection_guard", { pid: proc.pid }).catch(() => null);
      if (verdict && !verdict.allowed) {
        refused++;
        continue;
      }
      invoke("bridge_inject", { pid: proc.pid, arch: proc.arch, force: false }).catch(() => {});
    }
    if (refused > 0) notify(t("process.guardRefusedCount", { count: refused }), "warning");
  }

  async function saveSlot(slot: ShortcutSlot, value: string) {
    // Windows keeps these for itself: registration either fails outright or
    // succeeds and never fires. Refusing here is the only honest answer.
    if (value && isReservedCombo(value)) {
      notify(t("shortcut.reserved", { shortcut: shortcutLabel(value) }), "error");
      return;
    }
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

  /** The chord that is actually in effect for a slot — the profile's own
   *  binding when it has one, the global one otherwise. */
  function effectiveChord(slot: ShortcutSlot): string {
    const preview = previewShortcuts(globalShortcuts(current), profile ? profile.shortcuts : null);
    return preview.shortcuts[slot] ?? "";
  }

  function cell(slot: ShortcutSlot) {
    const raw = profile ? profile.shortcuts[slot] : undefined;
    const muted = raw === "";
    const stored = profile ? (raw ?? "") : String(current[slot] ?? "");
    const preview = previewShortcuts(globalShortcuts(current), profile ? profile.shortcuts : null);
    const effective = preview.shortcuts[slot];
    // A chord the OS refused looks identical to a working one until it is
    // pressed, so the field has to say so.
    const unavailable = effective ? shortcutStatus[effective] === false : false;
    return (
      <ShortcutField
        value={stored}
        inheritFrom={profile && raw === undefined ? String(current[slot] ?? "") : undefined}
        muted={muted}
        onRestore={muted ? () => restoreSlot(slot) : undefined}
        conflict={preview.conflicts.includes(slot)}
        unavailable={unavailable}
        onChange={v => { void saveSlot(slot, v); }}
      />
    );
  }

  return (
    <Box sx={{ height: "calc(100vh - 48px)", display: "flex", gap: 1.5, px: 1.5, pb: 2 }}>
      {wide && (
        <Paper elevation={0} sx={{
          mt: 2, width: 176, flexShrink: 0, display: "flex", flexDirection: "column",
          border: 1, borderColor: "divider", overflow: "hidden",
        }}>
          <Box sx={{ flex: 1, minHeight: 0, overflowY: "auto", py: 0.5 }}>
            {profileItem({
              icon: <PublicIcon sx={{ fontSize: 17, color: "text.secondary", flexShrink: 0 }} />,
              label: t("settings.profileGlobal"),
              selected: !profile,
              active: !activeProfile,
              onClick: () => setSelectedId("global"),
            })}
            {profiles.length > 0 && <Divider sx={{ mx: 1.5, my: 0.5 }} />}
            {profiles.map(item => profileItem({
              key: item.id,
              icon: <WindowIcon sx={{ fontSize: 17, color: "text.disabled", flexShrink: 0 }} />,
              label: item.name,
              selected: profile?.id === item.id,
              active: activeProfile?.id === item.id,
              onClick: () => setSelectedId(item.id),
            }))}
          </Box>
          <Box sx={{ p: 1, borderTop: 1, borderColor: "divider" }}>
            <Button size="small" fullWidth variant="outlined" onClick={() => setDialogOpen(true)}>
              {t("settings.profileNew")}
            </Button>
          </Box>
        </Paper>
      )}
      <Box sx={{ flex: 1, minWidth: 0, overflow: "auto" }}>
        <Paper elevation={0} sx={{ mt: 2, p: 2, bgcolor: "background.paper", border: 1, borderColor: "divider" }}>
          {!wide && (
            <Row label={t("settings.profile")}>
              <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap", justifyContent: "flex-end" }}>
                {profileSelect}
                <Button size="small" onClick={() => setDialogOpen(true)}>
                  {profile ? t("settings.profileEdit") : t("settings.profileNew")}
                </Button>
                {profile && (
                  <Button size="small" color="error" onClick={() => setConfirmDelete(true)}>{t("settings.profileDelete")}</Button>
                )}
              </Box>
            </Row>
          )}
          {profile && (
            <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, flexWrap: "wrap", mb: 1, minHeight: 24 }}>
              <Typography variant="caption" color="text.disabled">{t("settings.profileAppliesTo")}</Typography>
              {profile.processes.map(name => (
                <Chip key={name} size="small" label={exeBase(name)} sx={{ height: 20, fontSize: "0.72rem" }} />
              ))}
              <Tooltip title={t("settings.profileWhenForeground")} arrow>
                <InfoOutlinedIcon sx={{ fontSize: 14, color: "text.disabled", cursor: "help" }} />
              </Tooltip>
              <Box sx={{ flex: 1 }} />
              {wide && (
                <>
                  <Button size="small" onClick={() => setDialogOpen(true)}>{t("settings.profileEdit")}</Button>
                  <Button size="small" color="error" onClick={() => setConfirmDelete(true)}>{t("settings.profileDelete")}</Button>
                </>
              )}
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
        {!profile && failedGlobal.length > 0 && (
          <Alert severity="error" sx={{ mb: 1, py: 0.25 }}>
            {t("settings.registerFailedCount", { count: failedGlobal.length })}
          </Alert>
        )}
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
              {labelCell(t("settings.increase"), overridesFor(["increaseSpeedShortcut"], ["increaseSpeedStep"]))}
              <TableCell sx={{ border: "none" }}>{cell("increaseSpeedShortcut")}</TableCell>
              <TableCell sx={{ border: "none" }}>{numberCell("increaseSpeedStep", 0.1)}</TableCell>
            </TableRow>
            <TableRow>
              {labelCell(t("settings.decrease"), overridesFor(["decreaseSpeedShortcut"], ["decreaseSpeedStep"]))}
              <TableCell sx={{ border: "none" }}>{cell("decreaseSpeedShortcut")}</TableCell>
              <TableCell sx={{ border: "none" }}>{numberCell("decreaseSpeedStep", 0.1)}</TableCell>
            </TableRow>
            <TableRow>
              {labelCell(t("settings.reset"), overridesFor(["resetSpeedShortcut"]))}
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
                {labelCell(
                  <>{t("settings.gear")} {gear}</>,
                  overridesFor([`gear${gear}Shortcut` as ShortcutSlot], [`gear${gear}Speed` as SpeedValueKey]),
                )}
                <TableCell sx={{ border: "none" }}>{cell(`gear${gear}Shortcut` as ShortcutSlot)}</TableCell>
                <TableCell sx={{ border: "none" }}>{numberCell(`gear${gear}Speed` as SpeedValueKey, 1)}</TableCell>
              </TableRow>
            ))}
            {/* Hold shortcut — press to activate, release to reset */}
            <TableRow>
              {labelCell(t("settings.hold"), overridesFor(["holdShortcut"], ["holdSpeed"]))}
              <TableCell sx={{ border: "none" }}>{cell("holdShortcut")}</TableCell>
              <TableCell sx={{ border: "none" }}>{numberCell("holdSpeed", 2)}</TableCell>
            </TableRow>
          </TableBody>
        </Table>

        {/* ── 手柄快捷键 ── */}
        <Divider sx={{ my: 2 }}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            <SportsEsportsIcon sx={{ color: "secondary.main", fontSize: 18 }} />
            <Typography variant="subtitle2" sx={{ fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5, color: "text.secondary" }}>
              {t("settings.gamepad")}
            </Typography>
          </Box>
        </Divider>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          {t("settings.gamepadHint")}
        </Typography>
        <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.75 }}>
          {SHORTCUT_SLOTS.filter(target => effectiveChord(target).startsWith("Pad:")).length === 0 && (
            <Typography variant="caption" color="text.disabled">{t("settings.gamepadNone")}</Typography>
          )}
          {SHORTCUT_SLOTS.map(target => {
            const chord = effectiveChord(target);
            if (!chord.startsWith("Pad:")) return null;
            return (
              <Chip
                key={target}
                size="small"
                color="success"
                variant="outlined"
                label={`${target === "increaseSpeedShortcut" ? t("settings.increase") : target === "decreaseSpeedShortcut" ? t("settings.decrease") : target === "resetSpeedShortcut" ? t("settings.reset") : t("settings.hold")} · ${shortcutLabel(chord)}`}
                sx={{ height: 22, fontSize: "0.72rem" }}
              />
            );
          })}
        </Box>

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
        {/* Only meaningful while the app is registered to start with Windows,
            so it is disabled otherwise. */}
        <Row label={
          <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
            <VisibilityOffIcon sx={{ fontSize: 16, color: "text.secondary" }} />
            {t("settings.silentAutostart")}
            <Tooltip title={t("settings.silentAutostartHint")} arrow>
              <InfoOutlinedIcon sx={{ fontSize: 15, color: "text.disabled", cursor: "help" }} />
            </Tooltip>
          </Box>
        }>
          <Switch
            checked={!!settings.silentAutostart}
            disabled={!settings.autoStart}
            onChange={async (_, v) => {
              try {
                // Re-registering rewrites the autostart command line, which is
                // how an entry created by an older build picks up the launch
                // flag the backend keys on.
                if (v) await enable();
                set("silentAutostart", v);
              } catch (e) {
                // Keep the switch on the persisted value and say what failed.
                void reportError("autostart", "enable failed while enabling silent start", String(e));
              }
            }}
          />
        </Row>
        <Row label={<Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}><PushPinIcon sx={{ fontSize: 16, color: "text.secondary" }} />{t("settings.alwaysOnTop")}</Box>}>
          <Switch checked={settings.alwaysOnTop as boolean} onChange={(_, v) => {
            set("alwaysOnTop", v);
            invoke("set_always_on_top", { onTop: v });
          }} />
        </Row>
        <Row label={
          <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
            <SpeedIcon sx={{ fontSize: 16, color: "text.secondary" }} />
            {t("settings.autoApply")}
            <Tooltip title={t("settings.autoApplyHint")} arrow>
              <InfoOutlinedIcon sx={{ fontSize: 15, color: "text.disabled", cursor: "help" }} />
            </Tooltip>
          </Box>
        }>
          <Switch
            checked={settings["auto.apply"] as boolean}
            onChange={(_, v) => { void set("auto.apply", v); }}
          />
        </Row>
        <Row label={
          <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
            <LinkIcon sx={{ fontSize: 16, color: "text.secondary" }} />
            {t("settings.remoteControl")}
            <Tooltip title={t("settings.remoteControlHint")} arrow>
              <InfoOutlinedIcon sx={{ fontSize: 15, color: "text.disabled", cursor: "help" }} />
            </Tooltip>
          </Box>
        }>
          <Switch
            checked={settings["remote.control"] as boolean}
            onChange={async (_, v) => {
              set("remote.control", v);
              try {
                await invoke("remote_enable", { enabled: v });
                setRemote(await invoke<RemoteInfo>("remote_info"));
              } catch (e) {
                void reportError("remote", "remote_enable failed", String(e));
              }
            }}
          />
        </Row>
        {!!settings["remote.control"] && remote.enabled && (
          <Row label={t("settings.remoteControlUrl")}>
            <Typography
              variant="caption"
              sx={{ fontFamily: "monospace", color: "text.secondary", wordBreak: "break-all" }}
            >
              {remote.url}?token={remote.token}
            </Typography>
          </Row>
        )}
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
    </Box>
  );
}
