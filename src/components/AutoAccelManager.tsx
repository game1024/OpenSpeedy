import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { useInterval } from "ahooks";
import {
  Box, Typography, Divider, Switch, Table, TableBody, TableCell, TableHead, TableRow,
  Select, MenuItem, TextField, Button, IconButton, Tooltip, Chip,
} from "@mui/material";
import BoltIcon from "@mui/icons-material/Bolt";
import EditIcon from "@mui/icons-material/Edit";
import DeleteIcon from "@mui/icons-material/Delete";
import {
  useAutoAccel, setAutoAccelEnabled, upsertAutoRule, removeAutoRule,
  type AutoRule,
} from "../store/autoAccel";
import { useSettings } from "../hooks/useSettings";
import { useSnackbar } from "../contexts/SnackbarContext";
import { reportError } from "../utils/frontendLog";

interface RunningProcess {
  name: string;
  exe_path: string | null;
  arch: string;
}

const MANUAL = "__manual__";

function speedLabel(rule: AutoRule, gearName: (n: number) => string): string {
  if (rule.gear) return gearName(rule.gear);
  return `${rule.speed.toFixed(3)}×`;
}

export default function AutoAccelManager() {
  const { t } = useTranslation();
  const { config } = useAutoAccel();
  const { settings } = useSettings();
  const { notify } = useSnackbar();

  const [processes, setProcesses] = useState<RunningProcess[]>([]);
  const [selected, setSelected] = useState("");
  const [manualName, setManualName] = useState("");
  const [mode, setMode] = useState("custom");
  const [customSpeed, setCustomSpeed] = useState("2.0");

  const gears = useMemo(
    () => settings
      ? [1, 2, 3, 4, 5].map(i => Number(settings[`gear${i}Speed` as keyof typeof settings]) || 1)
      : [1, 2, 5, 10, 100],
    [settings],
  );

  const loadProcesses = async () => {
    try {
      const list = await invoke<RunningProcess[]>("get_process_list_fast");
      const unique = new Map<string, RunningProcess>();
      for (const p of list) {
        const key = p.name.toLowerCase();
        if (!unique.has(key)) unique.set(key, p);
      }
      setProcesses([...unique.values()].sort((a, b) => a.name.localeCompare(b.name)));
    } catch (e) {
      void reportError("autoAccel", "get_process_list_fast failed", String(e));
    }
  };

  useEffect(() => { void loadProcesses(); }, []);
  useInterval(() => { void loadProcesses(); }, 5000);

  const name = (selected === MANUAL ? manualName : selected).trim();
  const gearIndex = mode.startsWith("gear") ? Number(mode.slice(4)) : null;
  const speed = gearIndex ? gears[gearIndex - 1] : Number(customSpeed);
  const valid = !!name && Number.isFinite(speed) && speed >= 0.001 && speed <= 1000;

  async function toggleEnabled(on: boolean) {
    try {
      await setAutoAccelEnabled(on);
    } catch (e) {
      void reportError("autoAccel", "set_auto_accel_enabled failed", String(e));
      notify(t("autoAccel.saveFail"), "error");
    }
  }

  async function handleBind() {
    if (!valid) {
      notify(t("autoAccel.invalid"), "error");
      return;
    }
    const found = processes.find(p => p.name.toLowerCase() === name.toLowerCase());
    const rule: AutoRule = {
      name,
      exe_path: found?.exe_path ?? null,
      arch: found?.arch ?? null,
      speed,
      gear: gearIndex,
    };
    try {
      await upsertAutoRule(rule);
      // Binding a game is itself the request to enable auto acceleration;
      // the master switch stays independently available afterwards.
      if (!config.enabled) await setAutoAccelEnabled(true);
      notify(t("autoAccel.saved", { name }), "success");
      setSelected("");
      setManualName("");
    } catch (e) {
      void reportError("autoAccel", "upsert_auto_rule failed", String(e));
      notify(t("autoAccel.saveFail"), "error");
    }
  }

  async function handleRemove(rule: AutoRule) {
    try {
      await removeAutoRule(rule.name);
      notify(t("autoAccel.removed", { name: rule.name }), "success");
    } catch (e) {
      void reportError("autoAccel", "remove_auto_rule failed", String(e));
      notify(t("autoAccel.saveFail"), "error");
    }
  }

  function handleEdit(rule: AutoRule) {
    const found = processes.find(p => p.name.toLowerCase() === rule.name.toLowerCase());
    if (found) {
      setSelected(found.name);
      setManualName("");
    } else {
      setSelected(MANUAL);
      setManualName(rule.name);
    }
    if (rule.gear) setMode(`gear${rule.gear}`);
    else {
      setMode("custom");
      setCustomSpeed(String(rule.speed));
    }
  }

  const gearName = (n: number) => t("autoAccel.gearLabel", { n, speed: gears[n - 1] });

  return (
    <Box>
      <Divider sx={{ my: 2 }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <BoltIcon sx={{ color: "warning.main", fontSize: 18 }} />
          <Typography variant="subtitle2" sx={{ fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5, color: "text.secondary" }}>
            {t("autoAccel.title")}
          </Typography>
        </Box>
      </Divider>

      <Box sx={{ display: "flex", alignItems: "center", py: 0.8, px: 1 }}>
        <Typography component="span" variant="body2" sx={{ flex: 1 }}>{t("autoAccel.enable")}</Typography>
        <Switch checked={config.enabled} onChange={(_, on) => void toggleEnabled(on)} />
      </Box>
      <Typography variant="caption" color="text.secondary" sx={{ display: "block", px: 1, mb: 1.5 }}>
        {t("autoAccel.hint")}
      </Typography>
      {!config.enabled && config.rules.length > 0 && (
        <Chip size="small" color="warning" label={t("autoAccel.offWarning")} sx={{ ml: 1, mb: 1.5 }} />
      )}

      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell sx={{ border: "none", fontSize: "0.75rem" }}>{t("autoAccel.process")}</TableCell>
            <TableCell sx={{ border: "none", fontSize: "0.75rem" }}>{t("autoAccel.speed")}</TableCell>
            <TableCell align="right" sx={{ border: "none", fontSize: "0.75rem" }}>{t("autoAccel.actions")}</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {config.rules.map(rule => (
            <TableRow key={rule.name.toLowerCase()}>
              <TableCell sx={{ border: "none", py: 0.5 }}>
                <Typography variant="body2" sx={{ fontWeight: 500 }}>{rule.name}</Typography>
                {rule.exe_path && (
                  <Typography variant="caption" color="text.disabled" noWrap sx={{ display: "block", maxWidth: 260, fontSize: "0.65rem" }}>
                    {rule.exe_path}
                  </Typography>
                )}
              </TableCell>
              <TableCell sx={{ border: "none", py: 0.5 }}>
                <Typography variant="body2" sx={{ fontVariantNumeric: "tabular-nums" }}>{speedLabel(rule, gearName)}</Typography>
              </TableCell>
              <TableCell align="right" sx={{ border: "none", py: 0.5, whiteSpace: "nowrap" }}>
                <Tooltip title={t("autoAccel.edit")}>
                  <IconButton size="small" onClick={() => handleEdit(rule)} aria-label={t("autoAccel.edit")}>
                    <EditIcon sx={{ fontSize: 16 }} />
                  </IconButton>
                </Tooltip>
                <Tooltip title={t("autoAccel.remove")}>
                  <IconButton size="small" onClick={() => void handleRemove(rule)} aria-label={t("autoAccel.remove")}>
                    <DeleteIcon sx={{ fontSize: 16 }} />
                  </IconButton>
                </Tooltip>
              </TableCell>
            </TableRow>
          ))}
          {config.rules.length === 0 && (
            <TableRow>
              <TableCell colSpan={3} sx={{ border: "none", textAlign: "center", color: "text.disabled" }}>
                <Typography variant="caption">{t("autoAccel.empty")}</Typography>
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>

      {/* ── Bind a game ── */}
      <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap", alignItems: "center", px: 1, mt: 1.5 }}>
        <Select
          size="small"
          value={selected}
          onChange={e => setSelected(e.target.value)}
          displayEmpty
          sx={{ minWidth: 210, fontSize: "0.8rem" }}
        >
          <MenuItem value="" disabled>{t("autoAccel.selectProcess")}</MenuItem>
          {processes.map(p => <MenuItem key={p.name.toLowerCase()} value={p.name}>{p.name}</MenuItem>)}
          <MenuItem value={MANUAL}>{t("autoAccel.manual")}</MenuItem>
        </Select>

        {selected === MANUAL && (
          <TextField
            size="small"
            value={manualName}
            onChange={e => setManualName(e.target.value)}
            placeholder={t("autoAccel.manualPlaceholder")}
            sx={{ width: 170 }}
            slotProps={{ htmlInput: { autoComplete: "off" } }}
          />
        )}

        <Select
          size="small"
          value={mode}
          onChange={e => setMode(e.target.value)}
          sx={{ minWidth: 150, fontSize: "0.8rem" }}
        >
          <MenuItem value="custom">{t("autoAccel.custom")}</MenuItem>
          {gears.map((_, i) => <MenuItem key={i} value={`gear${i + 1}`}>{gearName(i + 1)}</MenuItem>)}
        </Select>

        {mode === "custom" && (
          <TextField
            type="number"
            size="small"
            value={customSpeed}
            onChange={e => setCustomSpeed(e.target.value)}
            sx={{ width: 100 }}
            slotProps={{ htmlInput: { min: 0.001, max: 1000, step: 0.1, "aria-label": t("autoAccel.customSpeed") } }}
          />
        )}

        <Button variant="contained" size="small" onClick={() => void handleBind()} disabled={!valid} sx={{ textTransform: "none" }}>
          {t("autoAccel.bind")}
        </Button>
      </Box>

      <Typography variant="caption" color="text.disabled" sx={{ display: "block", px: 1, mt: 1.5 }}>
        {t("autoAccel.globalHint")}
      </Typography>
    </Box>
  );
}
