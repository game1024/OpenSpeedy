import React, { useState, useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  Box, Paper, Typography, Avatar, Chip, Divider,
  Table, TableCell, TableHead, TableRow,
} from "@mui/material";
import WindowIcon from "@mui/icons-material/Window";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import ExtensionIcon from "@mui/icons-material/Extension";

// ── Types ──────────────────────────────────────────────────────────────────

interface ProcessInfo {
  pid: number;
  name: string;
  arch: string;
  window_title: string | null;
  memory_kb: number;
  exe_path: string | null;
  admin: boolean;
}

interface SpeedState {
  injected: boolean;
  enabled: boolean;
  arch: string;
}

interface ModuleInfo {
  name: string;
  path: string;
  base_address: number;
  size: number;
}

interface ProcessDetailProps {
  process: ProcessInfo | null;
  speedState: SpeedState | undefined;
  icons: Record<number, string>;
}

// ── Constants ──────────────────────────────────────────────────────────────

const MOD_ROW_H = 28;

// ── Helpers ────────────────────────────────────────────────────────────────

function fmtMem(kb: number): string {
  if (kb >= 1024 * 1024) return `${(kb / (1024 * 1024)).toFixed(2)} GB`;
  if (kb >= 1024) return `${(kb / 1024).toFixed(1)} MB`;
  if (kb > 0) return `${kb} KB`;
  return "—";
}

function fmtSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

function fmtHex(addr: number): string {
  return "0x" + addr.toString(16).toUpperCase().padStart(8, "0");
}

// ── Detail row ─────────────────────────────────────────────────────────────

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <Box sx={{ display: "flex", alignItems: "flex-start", mb: 1.5 }}>
      <Typography variant="caption" sx={{ color: "text.disabled", minWidth: 100, flexShrink: 0, pt: 0.3 }}>
        {label}
      </Typography>
      <Box sx={{ flex: 1, minWidth: 0 }}>{value}</Box>
    </Box>
  );
}

// ── Module row ─────────────────────────────────────────────────────────────

const ModuleRow = React.memo(function ModuleRow({
  m, start,
}: {
  m: ModuleInfo; start: number;
}) {
  return (
    <Box sx={{
      display: "grid", gridTemplateColumns: "1fr 1fr 90px 80px",
      position: "absolute", top: 0, left: 0, right: 0,
      height: MOD_ROW_H, transform: `translateY(${start}px)`,
      alignItems: "center", borderBottom: 1, borderColor: "divider",
      "&:hover": { bgcolor: "action.hover" },
    }}>
      <Typography variant="caption" noWrap sx={{ px: 1, fontWeight: 500 }}>{m.name}</Typography>
      <Typography variant="caption" noWrap sx={{ px: 1, color: "text.disabled", fontSize: "0.65rem" }}>{m.path}</Typography>
      <Typography variant="caption" sx={{ px: 1, textAlign: "right", fontFamily: "monospace", fontSize: "0.65rem", color: "text.secondary" }}>{fmtHex(m.base_address)}</Typography>
      <Typography variant="caption" sx={{ px: 1, textAlign: "right", color: "text.secondary" }}>{fmtSize(m.size)}</Typography>
    </Box>
  );
});

// ── Component ──────────────────────────────────────────────────────────────

export default function ProcessDetail({ process, speedState, icons }: ProcessDetailProps) {
  const { t } = useTranslation();
  const [modules, setModules] = useState<ModuleInfo[]>([]);
  const [sortDir, setSortDir] = useState<'asc' | 'desc' | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const sortedModules = useMemo(() => {
    if (!sortDir) return modules;
    const sorted = [...modules].sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
    return sortDir === 'desc' ? sorted.reverse() : sorted;
  }, [modules, sortDir]);
  const vz = useVirtualizer({
    count: sortedModules.length,
    getScrollElement: () => scrollRef.current!,
    estimateSize: () => MOD_ROW_H,
    overscan: 8,
  });

  // Fetch modules when process changes
  useEffect(() => {
    if (process) {
      invoke<ModuleInfo[]>("get_process_modules", { pid: process.pid })
        .then(setModules)
        .catch(() => setModules([]));
    } else {
      setModules([]);
      setSortDir(null);
    }
  }, [process?.pid]);

  if (!process) {
    return (
      <Paper elevation={0} sx={{
        height: "100%", bgcolor: "background.paper", border: 1, borderColor: "divider",
        display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 2,
      }}>
        <InfoOutlinedIcon sx={{ fontSize: 48, color: "text.disabled" }} />
        <Typography variant="body2" color="text.disabled">
          {t("process.detail.noSelection")}
        </Typography>
      </Paper>
    );
  }

  const icon = icons[process.pid];
  const archColor = process.arch === "x86" ? "warning.main" : "secondary.main";

  return (
    <Paper elevation={0} sx={{
      height: "100%", bgcolor: "background.paper", border: 1, borderColor: "divider",
      display: "flex", flexDirection: "column", overflow: "hidden",
    }}>
      {/* Header */}
      <Box sx={{ px: 2, pt: 1.5, pb: 1, display: "flex", alignItems: "center", flexShrink: 0 }}>
        <InfoOutlinedIcon sx={{ color: "primary.main", fontSize: 18, mr: 1 }} />
        <Typography variant="caption" sx={{ fontWeight: 600, textTransform: "uppercase", letterSpacing: 1, color: "text.secondary" }}>
          {t("process.detail.title")}
        </Typography>
      </Box>
      <Divider />

      {/* Detail info (scrollable) */}
      <Box sx={{ px: 2, py: 2, overflow: "auto", flexShrink: 0, maxHeight: "45%" }}>
        {/* Process icon + name */}
        <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, mb: 2 }}>
          {icon ? (
            <Avatar src={icon} variant="rounded" sx={{ width: 40, height: 40, borderRadius: 1, flexShrink: 0 }} />
          ) : (
            <Avatar variant="rounded" sx={{ width: 40, height: 40, flexShrink: 0, bgcolor: "transparent", borderRadius: 1 }}>
              <WindowIcon sx={{ fontSize: 24, color: "text.disabled" }} />
            </Avatar>
          )}
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="subtitle1" noWrap sx={{ fontWeight: 600 }}>{process.name}</Typography>
            <Typography variant="caption" color="text.secondary">PID {process.pid}</Typography>
          </Box>
        </Box>

        <Divider sx={{ mb: 2 }} />

        {/* Detail fields */}
        <DetailRow label={t("process.detail.pid")} value={<Typography variant="body2">{process.pid}</Typography>} />
        <DetailRow label={t("process.detail.arch")} value={
          <Chip label={process.arch} size="small" sx={{ fontWeight: 600, fontSize: "0.7rem", bgcolor: archColor, color: "#fff" }} />
        } />
        <DetailRow label={t("process.detail.memory")} value={<Typography variant="body2">{fmtMem(process.memory_kb)}</Typography>} />
        <DetailRow label={t("process.detail.exePath")} value={
          <Typography variant="body2" sx={{ wordBreak: "break-all", fontSize: "0.8rem", color: process.exe_path ? "text.primary" : "text.disabled" }}>
            {process.exe_path || "—"}
          </Typography>
        } />
        <DetailRow label={t("process.detail.admin")} value={
          process.admin
            ? <Chip label={t("process.detail.yes")} size="small" sx={{ fontWeight: 600, fontSize: "0.7rem", bgcolor: "error.main", color: "#fff" }} />
            : <Typography variant="body2" color="text.disabled">{t("process.detail.no")}</Typography>
        } />

        <Divider sx={{ my: 0.5 }} />

        {/* Speed / injection status */}
        <DetailRow label={t("process.detail.speedStatus")} value={
          speedState?.enabled
            ? <Chip label={t("process.detail.statusEnabled")} size="small" sx={{ fontWeight: 600, fontSize: "0.7rem", bgcolor: "success.main", color: "#fff" }} />
            : speedState?.injected
              ? <Chip label={t("process.detail.statusDisabled")} size="small" sx={{ fontWeight: 600, fontSize: "0.7rem", bgcolor: "text.disabled", color: "#fff" }} />
              : <Chip label={t("process.detail.statusNotInjected")} size="small" variant="outlined" sx={{ fontWeight: 600, fontSize: "0.7rem" }} />
        } />
        <DetailRow label={t("process.detail.injected")} value={
          <Typography variant="body2">
            {speedState?.injected ? t("process.detail.yes") : t("process.detail.no")}
          </Typography>
        } />
      </Box>

      {/* Modules section */}
      <Divider />
      <Box sx={{ px: 2, pt: 1, pb: 0.5, display: "flex", alignItems: "center", flexShrink: 0 }}>
        <ExtensionIcon sx={{ color: "secondary.main", fontSize: 16, mr: 1 }} />
        <Typography variant="caption" sx={{ fontWeight: 600, textTransform: "uppercase", letterSpacing: 1, color: "text.secondary" }}>
          {t("process.detail.modules")}
        </Typography>
        <Typography variant="caption" sx={{ ml: 1, fontWeight: 600, color: "secondary.main" }}>
          {t("process.detail.modulesCount", { count: sortedModules.length })}
        </Typography>
      </Box>

      {/* Modules table header */}
      <Box sx={{ px: 2, flexShrink: 0 }}>
        <Table size="small" sx={{ tableLayout: "fixed" }}>
          <colgroup><col /><col /><col width={90} /><col width={80} /></colgroup>
          <TableHead><TableRow>
            <TableCell
              onClick={() => setSortDir(d => d === 'asc' ? 'desc' : d === 'desc' ? null : 'asc')}
              sx={{ py: 0.5, cursor: "pointer", userSelect: "none", "&:hover": { color: "primary.main" } }}
            >
              {t("process.detail.moduleName")}
              {sortDir === 'asc' ? ' ▲' : sortDir === 'desc' ? ' ▼' : ''}
            </TableCell>
            <TableCell sx={{ py: 0.5 }}>{t("process.detail.modulePath")}</TableCell>
            <TableCell align="right" sx={{ py: 0.5 }}>{t("process.detail.moduleBase")}</TableCell>
            <TableCell align="right" sx={{ py: 0.5 }}>{t("process.detail.moduleSize")}</TableCell>
          </TableRow></TableHead>
        </Table>
      </Box>
      <Divider />

      {/* Modules virtualized list */}
      <Box ref={scrollRef} sx={{ flex: 1, overflow: "auto", position: "relative", px: 2 }}>
        <div style={{ height: vz.getTotalSize(), width: 1 }} />
        {vz.getVirtualItems().map(vr => (
          <ModuleRow key={vr.index} m={sortedModules[vr.index]} start={vr.start} />
        ))}
        {sortedModules.length === 0 && (
          <Box sx={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Typography variant="caption" color="text.disabled">
              {process ? "—" : ""}
            </Typography>
          </Box>
        )}
      </Box>
    </Paper>
  );
}
