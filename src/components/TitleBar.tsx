import { Box, Typography, AppBar, Toolbar, Chip, CircularProgress } from "@mui/material";
import DeveloperBoardIcon from "@mui/icons-material/DeveloperBoard";
import MinimizeIcon from "@mui/icons-material/Minimize";
import CropSquareIcon from "@mui/icons-material/CropSquare";
import CloseIcon from "@mui/icons-material/Close";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import ErrorIcon from "@mui/icons-material/Error";
import { getCurrentWindow } from "@tauri-apps/api/window";

interface TitleBarProps {
  osVer: string;
  cpuPct: number;
  memPct: number;
  b64: boolean | null;
  b32: boolean | null;
}

export default function TitleBar({ osVer, cpuPct, memPct, b64, b32 }: TitleBarProps) {
  return (
    <AppBar position="static" elevation={0}
      sx={{ bgcolor: "background.paper", borderBottom: 1, borderColor: "divider", color: "text.primary" }}>
      <Toolbar variant="dense" sx={{ gap: 1.5, minHeight: 48, pr: "0 !important" }}
        data-tauri-drag-region>
        <DeveloperBoardIcon sx={{ color: "primary.main", fontSize: 20 }} />
        <Typography variant="caption" sx={{ color: "text.secondary", fontWeight: 500 }}>{osVer}</Typography>
        <Box sx={{ flex: 1 }} />

        <StatBadge value={cpuPct} label="CPU" />
        <StatBadge value={memPct} label="RAM" />

        <BridgeChip ok={b64} label="Bridge64" />
        <BridgeChip ok={b32} label="Bridge32" />

        <Box sx={{ display: "flex", height: 48, ml: 1, "& > div": { width: 46, display: "flex", alignItems: "center", justifyContent: "center", cursor: "default", "&:hover": { bgcolor: "action.hover" } } }}>
          <Box onClick={() => getCurrentWindow().minimize()}>
            <MinimizeIcon sx={{ fontSize: 16, color: "text.secondary" }} />
          </Box>
          <Box onClick={() => getCurrentWindow().toggleMaximize()}>
            <CropSquareIcon sx={{ fontSize: 14, color: "text.secondary" }} />
          </Box>
          <Box onClick={() => getCurrentWindow().hide()} title="隐藏到托盘" sx={{ "&:hover": { bgcolor: "#C42B1C !important", "& .MuiSvgIcon-root": { color: "#fff" } } }}>
            <CloseIcon sx={{ fontSize: 16, color: "text.secondary" }} />
          </Box>
        </Box>
      </Toolbar>
    </AppBar>
  );
}

function StatBadge({ value, label }: { value: number; label: string }) {
  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 0.8, mr: 0.5 }}>
      <Box sx={{ position: "relative", display: "inline-flex" }}>
        <CircularProgress variant="determinate" value={100} size={28} thickness={5} sx={{ color: "divider" }} />
        <CircularProgress variant="determinate" value={value} size={28} thickness={5}
          sx={{ position: "absolute", left: 0, color: value > 80 ? "error.main" : value > 60 ? "warning.main" : "primary.main" }} />
      </Box>
      <Box>
        <Typography variant="caption" sx={{ fontWeight: 600, fontSize: "0.7rem", lineHeight: 1 }}>{value.toFixed(0)}%</Typography>
        <Typography variant="caption" sx={{ color: "text.disabled", fontSize: "0.6rem", display: "block", lineHeight: 1 }}>{label}</Typography>
      </Box>
    </Box>
  );
}

function BridgeChip({ ok, label }: { ok: boolean | null; label: string }) {
  return (
    <Chip
      icon={ok === null ? undefined : ok ? <CheckCircleIcon /> : <ErrorIcon />}
      label={ok === null ? label : ok ? label : label}
      size="small"
      color={ok === null ? "default" : ok ? "success" : "error"}
      variant="filled"
      sx={{ height: 24, fontSize: "0.7rem" }}
    />
  );
}
