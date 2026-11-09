import React, { useState, useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useInterval } from "ahooks";
import { Splitter } from "antd";
import {
  Box, Paper, Typography, Avatar, Switch, TextField, IconButton, Tooltip,
  Divider, Table, TableCell, TableHead, TableRow, Tabs, Tab,
} from "@mui/material";
import WindowIcon from "@mui/icons-material/Window";
import SearchIcon from "@mui/icons-material/Search";
import MemoryIcon from "@mui/icons-material/Memory";
import VisibilityIcon from "@mui/icons-material/Visibility";
import VisibilityOffIcon from "@mui/icons-material/VisibilityOff";
import SpeedPanel from "./SpeedPanel";
import ProcessDetail from "./ProcessDetail";
import { useSettings, useSpeed } from "../hooks/useSettings";
import { getAcceleratedNames, addAcceleratedName, removeAcceleratedName } from "../store/process";

// ── Types & constants ────────────────────────────────────────────────────

interface ProcessInfo {
  pid: number;
  name: string;
  arch: string;
  window_title: string | null;
  memory_kb: number;
  exe_path: string | null;
  admin: boolean;
}

const ROW_H = 36;
const COL = { pid: 80, mem: 108, check: 96 } as const;

type SortCol = "pid" | "name" | "memory" | "enabled" | "count" | null;

function formatMem(kb: number): string {
  if (kb >= 1024 * 1024) return `${(kb / (1024 * 1024)).toFixed(1)} GB`;
  if (kb >= 1024) return `${(kb / 1024).toFixed(0)} MB`;
  return `${kb} KB`;
}

function ProcessIcon({ pid, icons }: { pid: number; icons: Record<number, string> }) {
  const src = icons[pid];
  if (src) return <Avatar src={src} variant="rounded" sx={{ width: 22, height: 22, flexShrink: 0, borderRadius: 0.5 }} />;
  return (
    <Avatar variant="rounded" sx={{ width: 22, height: 22, flexShrink: 0, bgcolor: "transparent", borderRadius: 0.5 }}>
      <WindowIcon sx={{ fontSize: 15, color: "text.disabled" }} />
    </Avatar>
  );
}

// ── Memoized process table (isolated from speed state) ───────────────────

const ProcessRow = React.memo(function ProcessRow({
  p, on, icons, start, selected, showMem, onToggle, onSelect,
}: {
  p: ProcessInfo; on: boolean; icons: Record<number, string>; start: number; selected: boolean;
  showMem: boolean;
  onToggle: (pid: number, arch: string) => void;
  onSelect: (pid: number) => void;
}) {
  const cols = showMem
    ? `${COL.pid}px 1fr ${COL.mem}px ${COL.check}px`
    : `${COL.pid}px 1fr ${COL.check}px`;
  return (
    <Box
      onClick={() => onSelect(p.pid)}
      sx={{
        display: "grid", gridTemplateColumns: cols,
        position: "absolute", top: 0, left: 0, right: 0, height: ROW_H, transform: `translateY(${start}px)`,
        alignItems: "center", borderBottom: 1, borderColor: "divider", cursor: "pointer",
        bgcolor: selected ? "rgba(92,107,192,0.12)" : on ? "action.selected" : "transparent",
        "&:hover": { bgcolor: selected ? "rgba(92,107,192,0.18)" : on ? "action.selected" : "action.hover" },
      }}
    >
      <Typography variant="body2" color="text.secondary" sx={{ fontSize: "0.8rem" }}>{p.pid}</Typography>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1.2, minWidth: 0 }}>
        <ProcessIcon pid={p.pid} icons={icons} />
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="body2" noWrap sx={{ fontWeight: 500, fontSize: "0.8rem" }}>{p.name}</Typography>
          {p.window_title && <Typography variant="caption" noWrap sx={{ color: "text.disabled", display: "block", lineHeight: 1.2, fontSize: "0.65rem" }}>{p.window_title}</Typography>}
        </Box>
      </Box>
      {showMem && <Typography variant="body2" color="text.secondary" sx={{ textAlign: "right", pr: 1, fontSize: "0.8rem" }}>{formatMem(p.memory_kb)}</Typography>}
      <Box sx={{ textAlign: "right", pr: 1 }}><Switch size="small" checked={on} onChange={() => onToggle(p.pid, p.arch)} /></Box>
    </Box>
  );
}, (prev, next) =>
  prev.p.pid === next.p.pid && prev.on === next.on && prev.start === next.start && prev.selected === next.selected && prev.showMem === next.showMem
);

const ProcessTable = function ProcessTable({
  processes, filtered, search, onSearch, icons, enabled, selectedPid, onToggle, onSelect,
  nameGroups, nameFiltered, onToggleName, tab, onTabChange, showSystem, onShowSystemChange,
}: {
  processes: ProcessInfo[];
  filtered: ProcessInfo[];
  search: string;
  onSearch: (v: string) => void;
  icons: Record<number, string>;
  enabled: Set<number>;
  selectedPid: number | null;
  onToggle: (pid: number, arch: string) => void;
  onSelect: (pid: number) => void;
  nameGroups: Map<string, { count: number; arch: string; pids: number[]; anyEnabled: boolean }>;
  nameFiltered: [string, { count: number; arch: string; pids: number[]; anyEnabled: boolean }][];
  onToggleName: (name: string) => void;
  tab: number;
  onTabChange: (v: number) => void;
  showSystem: boolean;
  onShowSystemChange: (v: boolean) => void;
}) {
  const { t } = useTranslation();
  const scrollRef = useRef<HTMLDivElement>(null);

  // Tab 0 = grouped by name (default), tab 1 = per-PID list
  const isPid = tab === 1;

  // ── Sorting ──────────────────────────────────────────────────────────
  // Default: PID mode by memory descending, name mode by name ascending
  const [sortCol, setSortCol] = useState<SortCol>(isPid ? "memory" : "name");
  const [sortAsc, setSortAsc] = useState(!isPid);

  useEffect(() => { setSortCol(isPid ? "memory" : "name"); setSortAsc(!isPid); }, [tab]);

  function toggleSort(col: SortCol) {
    if (sortCol === col) { setSortAsc(!sortAsc); } else { setSortCol(col); setSortAsc(true); }
  }
  function sortIcon(col: SortCol) {
    if (sortCol !== col) return "";
    return sortAsc ? " ▲" : " ▼";
  }

  const sorted = useMemo(() => {
    const list = isPid ? [...filtered] : [...nameFiltered];
    if (!sortCol) return list;
    list.sort((a, b) => {
      let cmp = 0;
      if (isPid) {
        const pa = a as ProcessInfo, pb = b as ProcessInfo;
        switch (sortCol) {
          case "pid": cmp = pa.pid - pb.pid; break;
          case "name": cmp = pa.name.localeCompare(pb.name); break;
          case "memory": cmp = pa.memory_kb - pb.memory_kb; break;
          case "enabled": cmp = (enabled.has(pa.pid) ? 1 : 0) - (enabled.has(pb.pid) ? 1 : 0); break;
        }
      } else {
        const ga = a as [string, { count: number; arch: string; pids: number[]; anyEnabled: boolean }];
        const gb = b as [string, { count: number; arch: string; pids: number[]; anyEnabled: boolean }];
        switch (sortCol) {
          case "count": cmp = ga[1].count - gb[1].count; break;
          case "name": cmp = ga[0].localeCompare(gb[0]); break;
          case "enabled": cmp = (ga[1].anyEnabled ? 1 : 0) - (gb[1].anyEnabled ? 1 : 0); break;
        }
      }
      return sortAsc ? cmp : -cmp;
    });
    return list;
  }, [isPid, filtered, nameFiltered, sortCol, sortAsc, enabled]);

  const items = isPid ? sorted.length : sorted.length;
  const total = isPid ? processes.length : nameGroups.size;

  const vz = useVirtualizer({ count: items, getScrollElement: () => scrollRef.current!, estimateSize: () => ROW_H, overscan: 12 });

  const gridCols = isPid
    ? `${COL.pid}px 1fr ${COL.mem}px ${COL.check}px`
    : `${COL.pid}px 1fr ${COL.check}px`;

  return (
    <Paper elevation={0} sx={{ height: "100%", bgcolor: "background.paper", border: 1, borderColor: "divider", display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <Box sx={{ px: 2, pt: 1.5, pb: 0.5, display: "flex", alignItems: "center" }}>
        <MemoryIcon sx={{ color: "primary.main", fontSize: 18, mr: 1 }} />
        <Typography variant="caption" sx={{ fontWeight: 600, textTransform: "uppercase", letterSpacing: 1, color: "text.secondary" }}>{t("process.title")}</Typography>
        <Typography variant="caption" sx={{ ml: 1, fontWeight: 600, color: "primary.main" }}>{items} / {total}</Typography>
        <Tooltip title={t("process.showSystem")}>
          <IconButton
            size="small"
            aria-label={t("process.showSystem")}
            aria-pressed={showSystem}
            onClick={() => onShowSystemChange(!showSystem)}
            sx={{ ml: 0.5, color: showSystem ? "primary.main" : "text.disabled" }}
          >
            {showSystem ? <VisibilityIcon sx={{ fontSize: 18 }} /> : <VisibilityOffIcon sx={{ fontSize: 18 }} />}
          </IconButton>
        </Tooltip>
        <Box sx={{ flex: 1 }} />
        <Tabs value={tab} onChange={(_, v) => { onTabChange(v); scrollRef.current?.scrollTo(0, 0); }}
          sx={{ minHeight: 0, "& .MuiTab-root": { minHeight: 32, py: 0, fontSize: "0.75rem" } }}>
          <Tab label={t("process.byName")} />
          <Tab label={t("process.byPid")} />
        </Tabs>
      </Box>

      <Box sx={{ px: 2, pb: 1, display: "flex", alignItems: "center", gap: 1 }}>
        <TextField placeholder={t("process.search")} variant="outlined" size="small" fullWidth value={search} onChange={e => onSearch(e.target.value)} slotProps={{ htmlInput: { autoComplete: "off" } }} />
      </Box>
      <Divider />

      <Box sx={{ px: 2, flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <Table size="small" sx={{ tableLayout: "fixed", flexShrink: 0 }}>
          <colgroup>
            <col width={COL.pid} /><col />
            {isPid && <col width={COL.mem} style={{ textAlign: "right" }} />}
            <col width={COL.check} style={{ textAlign: "right" }} />
          </colgroup>
          <TableHead><TableRow>
            <TableCell onClick={() => toggleSort(isPid ? "pid" : "count")} sx={{ cursor: "pointer", userSelect: "none", fontSize: "0.75rem", py: 0.5 }}>{isPid ? t("process.pid") : t("process.count")}{sortIcon(isPid ? "pid" : "count")}</TableCell>
            <TableCell onClick={() => toggleSort("name")} sx={{ cursor: "pointer", userSelect: "none", fontSize: "0.75rem", py: 0.5 }}>{t("process.name")}{sortIcon("name")}</TableCell>
            {isPid && <TableCell align="right" onClick={() => toggleSort("memory")} sx={{ cursor: "pointer", userSelect: "none", fontSize: "0.75rem", py: 0.5 }}>{t("process.memory")}{sortIcon("memory")}</TableCell>}
            <TableCell align="right" onClick={() => toggleSort("enabled")} sx={{ cursor: "pointer", userSelect: "none", fontSize: "0.75rem", py: 0.5 }}>{t("process.enable")}{sortIcon("enabled")}</TableCell>
          </TableRow></TableHead>
        </Table>

        <Box ref={scrollRef} sx={{ flex: 1, overflow: "auto", position: "relative" }}>
          <div style={{ height: vz.getTotalSize(), width: 1 }} />
          {isPid
            ? vz.getVirtualItems().map(vr => {
                const p = (sorted as ProcessInfo[])[vr.index];
                return <ProcessRow key={p.pid} p={p} on={enabled.has(p.pid)} icons={icons} start={vr.start} selected={selectedPid === p.pid} showMem={true} onToggle={onToggle} onSelect={onSelect} />;
              })
            : vz.getVirtualItems().map(vr => {
                const [name, group] = (sorted as [string, { count: number; arch: string; pids: number[]; anyEnabled: boolean }][])[vr.index];
                return (
                  <Box
                    key={name}
                    onClick={() => onSelect(group.pids[0])}
                    sx={{
                      display: "grid", gridTemplateColumns: gridCols,
                      position: "absolute", top: 0, left: 0, right: 0, height: ROW_H, transform: `translateY(${vr.start}px)`,
                      alignItems: "center", borderBottom: 1, borderColor: "divider", cursor: "pointer",
                      bgcolor: selectedPid !== null && group.pids.includes(selectedPid) ? "rgba(92,107,192,0.12)" : group.anyEnabled ? "action.selected" : "transparent",
                      "&:hover": { bgcolor: "action.hover" },
                    }}
                  >
                    <Typography variant="body2" color="text.secondary" sx={{ fontSize: "0.8rem" }}>{group.count}</Typography>
                    <Box sx={{ display: "flex", alignItems: "center", gap: 1.2, minWidth: 0 }}>
                      <ProcessIcon pid={group.pids[0]} icons={icons} />
                      <Box sx={{ minWidth: 0 }}>
                        <Typography variant="body2" noWrap sx={{ fontWeight: 500, fontSize: "0.8rem" }}>{name}</Typography>
                      </Box>
                    </Box>
                    <Box sx={{ textAlign: "right", pr: 1 }}><Switch size="small" checked={group.anyEnabled} onChange={() => onToggleName(name)} /></Box>
                  </Box>
                );
              })}
          {items === 0 && (
            <Box sx={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 1 }}>
              <SearchIcon sx={{ color: "text.disabled", fontSize: 36 }} />
              <Typography variant="body2" color="text.disabled">{search ? t("process.noResults") : t("process.loading")}</Typography>
            </Box>
          )}
        </Box>
      </Box>
    </Paper>
  );
}

// ── Component ────────────────────────────────────────────────────────────

interface SpeedState {
  injected: boolean;
  enabled: boolean;
  arch: string;
}

export default function ProcessManager() {
  const [processes, setProcesses] = useState<ProcessInfo[]>([]);
  const [search, setSearch] = useState("");
  const [icons, setIcons] = useState<Record<number, string>>({});
  const [speedMap, setSpeedMap] = useState<Map<number, SpeedState>>(new Map());
  const [selectedPid, setSelectedPid] = useState<number | null>(null);
  const [tab, setTab] = useState(0);
  // Off by default — protected system processes report 0 memory because their
  // handle cannot be opened
  const [showSystem, setShowSystem] = useState(false);
  const { settings } = useSettings();
  const { speed, setSpeed, commitSpeed } = useSpeed();

  const gears = useMemo(() => settings
    ? [1, 2, 3, 4, 5].map(i => (settings[`gear${i}Speed` as keyof typeof settings] as number) || 1)
    : [1, 2, 5, 10, 100],
  [settings]);

  // Derive enabled set for UI
  const enabled = useMemo(() => {
    const s = new Set<number>();
    for (const [pid, st] of speedMap) { if (st.enabled) s.add(pid); }
    return s;
  }, [speedMap]);

  // Toggle — optimistic: set state immediately, fire backend call in background
  async function toggle(pid: number, arch: string) {
    const wasOn = speedMap.get(pid)?.enabled ?? false;

    if (!wasOn) {
      setSpeedMap(prev => { const n = new Map(prev); n.set(pid, { injected: true, enabled: true, arch }); return n; });
      invoke<boolean>("bridge_inject", { pid, arch })
        .catch((e) => { console.error("[toggle] bridge_inject error:", e); });
    } else {
      setSpeedMap(prev => { const n = new Map(prev); n.set(pid, { ...prev.get(pid)!, enabled: false }); return n; });
      invoke<boolean>("bridge_disable", { pid, arch })
        .catch(() => {});
    }
  }

  // Data fetch
  useEffect(() => { invoke<ProcessInfo[]>("get_process_list").then(setProcesses).catch(() => {}); }, []);
  useEffect(() => { if (search.trim()) { invoke<ProcessInfo[]>("get_process_list").then(setProcesses).catch(() => {}); } }, [search]);
  useInterval(async () => { try { setProcesses(await invoke<ProcessInfo[]>("get_process_list_fast")); } catch {} }, 1000);

  // Periodically inject saved process names
  useInterval(async () => {
    if (processes.length === 0) return;
    const names = await getAcceleratedNames();
    for (const name of names) {
      const procs = processes.filter(p =>
        p.name.toLowerCase() === name.toLowerCase() && !speedMap.get(p.pid)?.enabled
      );
      if (procs.length === 0) continue;
      const arch = procs[0].arch;
      setSpeedMap(prev => {
        const n = new Map(prev);
        for (const p of procs) {
          n.set(p.pid, { injected: true, enabled: true, arch });
        }
        return n;
      });
      for (const p of procs) {
        invoke<boolean>("bridge_inject", { pid: p.pid, arch }).catch(() => {});
      }
    }
  }, 1000);

  // Hide protected system processes (memory 0 = handle could not be opened)
  const visibleProcesses = useMemo(
    () => (showSystem ? processes : processes.filter(p => p.memory_kb > 0)),
    [processes, showSystem],
  );

  // Filter
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return visibleProcesses;
    return visibleProcesses.filter(p => p.name.toLowerCase().includes(q) || p.pid.toString().includes(q) || (p.window_title && p.window_title.toLowerCase().includes(q)));
  }, [visibleProcesses, search]);

  // Name grouping (for name-based toggle)
  const nameGroups = useMemo(() => {
    const map = new Map<string, { count: number; arch: string; pids: number[]; anyEnabled: boolean }>();
    for (const p of visibleProcesses) {
      const key = p.name.toLowerCase();
      const cur = map.get(key) || { count: 0, arch: p.arch, pids: [], anyEnabled: false };
      cur.count++;
      cur.pids.push(p.pid);
      if (speedMap.get(p.pid)?.enabled) cur.anyEnabled = true;
      map.set(key, cur);
    }
    return map;
  }, [visibleProcesses, speedMap]);

  const nameFiltered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return Array.from(nameGroups.entries());
    return Array.from(nameGroups.entries()).filter(([name]) => name.includes(q));
  }, [nameGroups, search]);

  async function toggleName(name: string) {
    const group = nameGroups.get(name.toLowerCase());
    if (!group) return;
    if (!group.anyEnabled) {
      addAcceleratedName(name);
      for (const pid of group.pids) {
        setSpeedMap(prev => { const n = new Map(prev); n.set(pid, { injected: true, enabled: true, arch: group.arch }); return n; });
      }
      for (const pid of group.pids) {
        invoke<boolean>("bridge_inject", { pid, arch: group.arch }).catch(() => {});
      }
    } else {
      removeAcceleratedName(name);
      for (const pid of group.pids) {
        setSpeedMap(prev => { const n = new Map(prev); const cur = n.get(pid); if (cur) n.set(pid, { ...cur, enabled: false }); return n; });
      }
      for (const pid of group.pids) {
        invoke<boolean>("bridge_disable", { pid, arch: group.arch }).catch(() => {});
      }
    }
  }

  // Icons
  useEffect(() => {
    const pids = processes.map(p => p.pid).filter(pid => !(pid in icons));
    if (!pids.length) return;
    const CONCURRENCY = 6; let i = 0;
    async function worker() { while (i < pids.length) { const pid = pids[i++]; const v = await invoke<string | null>("get_process_icon", { pid }).then(u => u ?? "").catch(() => ""); setIcons(p => ({ ...p, [pid]: v })); } }
    for (let w = 0; w < CONCURRENCY; w++) worker();
  }, [processes]);

  const selectedProcess = useMemo(() =>
    selectedPid ? processes.find(p => p.pid === selectedPid) ?? null : null,
  [processes, selectedPid]);
  const selectedSpeedState = selectedPid ? speedMap.get(selectedPid) : undefined;

  // Query real injection status from bridge when selecting a process
  useEffect(() => {
    const p = selectedProcess;
    if (!p) return;
    invoke<boolean | null>("bridge_get_status", { pid: p.pid, arch: p.arch })
      .then(status => {
        if (status === true) {
          setSpeedMap(prev => { const n = new Map(prev); n.set(p.pid, { injected: true, enabled: true, arch: p.arch }); return n; });
        } else if (status === false) {
          setSpeedMap(prev => { const n = new Map(prev); n.set(p.pid, { injected: true, enabled: false, arch: p.arch }); return n; });
        }
        // status === null means not injected — don't set anything
      })
      .catch(() => {});
  }, [selectedPid]);

  return (
    <Box sx={{ height: "calc(100vh - 48px)", display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <SpeedPanel speed={speed} gears={gears} onChange={setSpeed} onCommit={commitSpeed} />
      <Box sx={{ flex: 1, m: 1.5, overflow: "hidden" }}>
        <Splitter style={{ height: "100%" }}>
          <Splitter.Panel defaultSize="60%" min="300px">
            <ProcessTable
              processes={visibleProcesses} filtered={filtered} search={search} onSearch={setSearch}
              icons={icons} enabled={enabled} selectedPid={selectedPid}
              onToggle={toggle} onSelect={setSelectedPid}
              nameGroups={nameGroups} nameFiltered={nameFiltered} onToggleName={toggleName}
              tab={tab} onTabChange={setTab}
              showSystem={showSystem} onShowSystemChange={setShowSystem}
            />
          </Splitter.Panel>
          <Splitter.Panel min="250px">
            <ProcessDetail process={selectedProcess} speedState={selectedSpeedState} icons={icons} />
          </Splitter.Panel>
        </Splitter>
      </Box>
    </Box>
  );
}
