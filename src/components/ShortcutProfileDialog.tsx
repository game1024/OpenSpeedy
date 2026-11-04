import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import {
  Box, Button, Checkbox, Dialog, DialogActions, DialogContent, DialogTitle,
  IconButton, TextField, Tooltip, Typography,
} from "@mui/material";
import SearchIcon from "@mui/icons-material/Search";
import WindowIcon from "@mui/icons-material/Window";
import VisibilityIcon from "@mui/icons-material/Visibility";
import VisibilityOffIcon from "@mui/icons-material/VisibilityOff";
import {
  exeBase, exeKey, nextProfileName, occupiedBy, PROFILE_NAME_MAX, validateProfileName,
  type NameError, type ShortcutProfile,
} from "../shortcutProfile";

interface ProcessInfo {
  pid: number;
  name: string;
  window_title: string | null;
  memory_kb: number;
}

interface Props {
  open: boolean;
  profiles: readonly ShortcutProfile[];
  initial: ShortcutProfile | null;
  onCancel: () => void;
  onSave: (profile: ShortcutProfile) => void;
}

export default function ShortcutProfileDialog({ open, profiles, initial, onCancel, onSave }: Props) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [processes, setProcesses] = useState<ProcessInfo[]>([]);
  const [icons, setIcons] = useState<Record<number, string>>({});
  const [query, setQuery] = useState("");
  const [showSystem, setShowSystem] = useState(false);

  const asked = useRef(new Set<number>());

  useEffect(() => {
    if (!open) return;
    setName(initial?.name ?? nextProfileName(profiles, n => t("settings.profileDefaultName", { n })));
    setPicked((initial?.processes ?? []).map(exeBase).filter(Boolean));
    setQuery("");
    setShowSystem(false);
    let stop = false;
    const apply = (list: ProcessInfo[]) => { if (!stop) setProcesses(list); };
    // Full scan once, so a pid cached earlier with no memory reading is filled in.
    // Fast polls after that pick up processes started while the dialog stays open.
    invoke<ProcessInfo[]>("get_process_list").then(apply).catch(() => {});
    const timer = setInterval(() => {
      invoke<ProcessInfo[]>("get_process_list_fast").then(apply).catch(() => {});
    }, 1000);
    return () => { stop = true; clearInterval(timer); };
    // Reset only when the dialog opens. `initial` and `profiles` are read from that render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const groups = useMemo(() => {
    const visible = showSystem ? processes : processes.filter(p => p.memory_kb > 0);
    const map = new Map<string, { name: string; count: number; pid: number; title: string }>();
    for (const proc of visible) {
      const key = exeKey(proc.name);
      if (!key) continue;
      const cur = map.get(key);
      if (cur) {
        cur.count++;
        if (!cur.title && proc.window_title) cur.title = proc.window_title;
      } else {
        map.set(key, { name: proc.name, count: 1, pid: proc.pid, title: proc.window_title ?? "" });
      }
    }
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [processes, showSystem]);

  useEffect(() => {
    for (const group of groups) {
      if (asked.current.has(group.pid)) continue;
      asked.current.add(group.pid);
      invoke<string | null>("get_process_icon", { pid: group.pid })
        .then(src => { if (src) setIcons(prev => ({ ...prev, [group.pid]: src })); })
        .catch(() => {});
    }
  }, [groups]);

  const q = query.trim().toLowerCase();
  const shown = q
    ? groups.filter(g => g.name.toLowerCase().includes(q) || g.title.toLowerCase().includes(q))
    : groups;
  const runningKeys = new Set(groups.map(g => exeKey(g.name)));
  const kept = picked.filter(label => !occupiedBy(profiles, label, initial?.id));
  const resting = kept.filter(label => !runningKeys.has(exeKey(label)));
  const globalLabel = t("settings.profileGlobal");
  const nameError: NameError | null = validateProfileName(name, profiles, initial?.id, globalLabel);
  const nameHelp = nameError === "empty"
    ? t("settings.profileNameEmpty")
    : nameError === "long"
      ? t("settings.profileNameTooLong", { max: PROFILE_NAME_MAX })
      : nameError === "duplicate"
        ? t("settings.profileNameDuplicate")
        : nameError === "reserved"
          ? t("settings.profileNameReserved", { name: globalLabel })
          : "";

  function isPicked(label: string) {
    const key = exeKey(label);
    return picked.some(item => exeKey(item) === key);
  }

  function toggle(label: string) {
    const key = exeKey(label);
    setPicked(prev => prev.some(item => exeKey(item) === key)
      ? prev.filter(item => exeKey(item) !== key)
      : [...prev, exeBase(label)]);
  }

  function save() {
    if (nameError || kept.length === 0) return;
    onSave({
      id: initial?.id ?? crypto.randomUUID(),
      name,
      processes: kept,
      shortcuts: initial?.shortcuts ?? {},
      values: initial?.values,
    });
  }

  return (
    <Dialog open={open} onClose={onCancel} fullWidth maxWidth="sm">
      <DialogTitle>{initial ? t("settings.profileEdit") : t("settings.profileNew")}</DialogTitle>
      <DialogContent>
        <TextField
          size="small"
          fullWidth
          margin="dense"
          label={t("settings.profileName")}
          value={name}
          error={!!nameError}
          helperText={nameHelp}
          onChange={e => setName(e.target.value)}
          slotProps={{ htmlInput: { maxLength: [...name].length > PROFILE_NAME_MAX ? undefined : PROFILE_NAME_MAX } }}
        />
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, mt: 1 }}>
          <TextField
            size="small"
            fullWidth
            placeholder={t("settings.profileSearch")}
            value={query}
            onChange={e => setQuery(e.target.value)}
          />
          <Tooltip title={t("process.showSystem")}>
            <IconButton size="small" onClick={() => setShowSystem(v => !v)} sx={{ color: showSystem ? "primary.main" : "text.disabled" }}>
              {showSystem ? <VisibilityIcon sx={{ fontSize: 18 }} /> : <VisibilityOffIcon sx={{ fontSize: 18 }} />}
            </IconButton>
          </Tooltip>
        </Box>
        <Box sx={{ mt: 1, maxHeight: 360, overflow: "auto", border: 1, borderColor: "divider" }}>
          {resting.map(label => (
            <ProcessPickRow
              key={exeKey(label)}
              label={label}
              caption={t("settings.profileNotRunning")}
              checked
              onToggle={() => toggle(label)}
            />
          ))}
          {shown.map(group => {
            const owner = occupiedBy(profiles, group.name, initial?.id);
            return (
              <ProcessPickRow
                key={exeKey(group.name)}
                label={group.name}
                count={group.count}
                caption={owner ? t("settings.profileUsedBy", { name: owner.name }) : group.title}
                icon={icons[group.pid]}
                checked={isPicked(group.name) && !owner}
                disabled={!!owner}
                onToggle={() => toggle(group.name)}
              />
            );
          })}
          {shown.length === 0 && resting.length === 0 && (
            <Box sx={{ py: 4, textAlign: "center" }}>
              <SearchIcon sx={{ color: "text.disabled", fontSize: 32 }} />
              <Typography variant="body2" color="text.disabled">{t("process.noResults")}</Typography>
            </Box>
          )}
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancel}>{t("settings.profileCancel")}</Button>
        <Button variant="contained" disabled={!!nameError || kept.length === 0} onClick={save}>
          {initial ? t("settings.profileSave") : t("settings.profileCreate")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function ProcessPickRow({ label, caption, count, icon, checked, disabled, onToggle }: {
  label: string;
  caption?: string;
  count?: number;
  icon?: string;
  checked: boolean;
  disabled?: boolean;
  onToggle: () => void;
}) {
  return (
    <Box
      onClick={() => { if (!disabled) onToggle(); }}
      sx={{
        display: "grid",
        gridTemplateColumns: "28px 22px 1fr 36px",
        gap: 1,
        alignItems: "center",
        height: 36,
        px: 1,
        borderBottom: 1,
        borderColor: "divider",
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.55 : 1,
        bgcolor: checked ? "rgba(92,107,192,0.12)" : "transparent",
        "&:hover": { bgcolor: disabled ? undefined : checked ? "rgba(92,107,192,0.18)" : "action.hover" },
      }}
    >
      <Typography variant="caption" color="text.secondary">{count ?? ""}</Typography>
      {icon
        ? <Box component="img" src={icon} sx={{ width: 18, height: 18 }} />
        : <WindowIcon sx={{ fontSize: 16, color: "text.disabled" }} />}
      <Box sx={{ minWidth: 0 }}>
        <Typography variant="body2" noWrap sx={{ fontSize: "0.8rem", fontWeight: 500 }}>{label}</Typography>
        {caption && <Typography variant="caption" noWrap sx={{ display: "block", color: "text.disabled", lineHeight: 1.1 }}>{caption}</Typography>}
      </Box>
      <Checkbox
        size="small"
        checked={checked}
        disabled={disabled}
        onClick={event => event.stopPropagation()}
        onChange={() => { if (!disabled) onToggle(); }}
        sx={{ p: 0 }}
      />
    </Box>
  );
}
