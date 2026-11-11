import { useState, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { getVersion, getName, getTauriVersion } from "@tauri-apps/api/app";
import { platform, arch, version as osVersion } from "@tauri-apps/plugin-os";
import { ThemeProvider, createTheme, CssBaseline, Box, Tabs, Tab, Typography, Paper, Switch, Chip, IconButton, Button, Divider } from "@mui/material";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import ErrorIcon from "@mui/icons-material/Error";
import SpeedIcon from "@mui/icons-material/Speed";
import SettingsIcon from "@mui/icons-material/Settings";
import InfoIcon from "@mui/icons-material/Info";
import DarkModeIcon from "@mui/icons-material/DarkMode";
import LightModeIcon from "@mui/icons-material/LightMode";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import TitleBar from "./components/TitleBar";
import appIcon from "../src-tauri/icons/icon.png";
import githubIcon from "./assets/github.svg";
import bmcIcon from "./assets/bmc.svg";
import steamIcon from "./assets/steam.svg";
import bilibiliIcon from "./assets/bilibili.svg";
import ProcessManager from "./components/ProcessManager";
import SettingsManager from "./components/SettingsManager";
import Diagnostics from "./components/Diagnostics";
import { useShortcut } from "./hooks/useShortcut";
import { useTray } from "./hooks/useTray";
import { useSettings } from "./hooks/useSettings";
import { useSnackbar } from "./contexts/SnackbarContext";

import { useInterval } from "ahooks";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-shell";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import BugReportIcon from "@mui/icons-material/BugReport";
import { reportError } from "./utils/frontendLog";

function App() {
  const { t } = useTranslation();
  const [tab, setTab] = useState(0);
  const [cpuPct, setCpuPct] = useState(0);
  const [memPct, setMemPct] = useState(0);
  const [osVer, setOsVer] = useState("");
  const [version, setVersion] = useState("");
  const [appName, setAppName] = useState("");
  const [tauriVersion, setTauriVersion] = useState("");
  const [platformType, setPlatformType] = useState("");
  const [platformArch, setPlatformArch] = useState("");
  const [platformVersion, setPlatformVersion] = useState("");
  const [b64, setB64] = useState<boolean | null>(null);
  const [b32, setB32] = useState<boolean | null>(null);
  const [gpuName, setGpuName] = useState("");
  const [gpuUsedMb, setGpuUsedMb] = useState(0);
  const [gpuTotalMb, setGpuTotalMb] = useState(0);
  const { settings, set } = useSettings();
  const { notify } = useSnackbar();
  const darkMode = settings?.theme === "dark";

  // Sync Blueprint dark mode class
  useEffect(() => {
    document.body.classList.toggle("bp5-dark", darkMode);
  }, [darkMode]);

  const handleCopySystemInfo = async () => {
    try {
      const issueInfo = {
        appName,
        appVersion: version,
        tauriVersion,
        platform: platformType,
        platformArch,
        platformVersion,
      };
      const issueJson = JSON.stringify(issueInfo, null, 2);
      await navigator.clipboard.writeText(issueJson);
      notify(t("about.copyInfoSuccess"), "success");
    } catch (error) {
      notify(t("about.copyInfoError"), "error");
    }
  };

  // Reveal the diagnostics log in Explorer, with the file selected so the user
  // knows exactly which file to send.
  const handleOpenLogs = async () => {
    try {
      await revealItemInDir(await invoke<string>("get_log_path"));
    } catch (e) {
      await reportError("openLog", String(e));
    }
  };

  const theme = useMemo(() => createTheme({
    palette: {
      mode: darkMode ? "dark" : "light",
      primary: { main: "#5C6BC0" },
      secondary: { main: "#00838F" },
      background: darkMode ? { default: "#0D1117", paper: "#161B22" } : { default: "#F5F6FA", paper: "#FFFFFF" },
    },
    typography: {
      fontFamily: '"Inter", "Segoe UI", system-ui, -apple-system, sans-serif',
    },
    components: {
      MuiCssBaseline: {
        styleOverrides: {
          body: { overflow: "hidden" },
          "::-webkit-scrollbar": { width: 6 },
          "::-webkit-scrollbar-track": { background: "transparent" },
          "::-webkit-scrollbar-thumb": { background: darkMode ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.12)", borderRadius: 3 },
          "::-webkit-scrollbar-thumb:hover": { background: darkMode ? "rgba(255,255,255,0.2)" : "rgba(0,0,0,0.22)" },
        },
      },
    },
  }), [darkMode]);

  const { init } = useShortcut();
  useEffect(() => { init(); }, [init]);

  useTray();

  useInterval(async () => {
    try {
      const s = await invoke<{ memory_pct: number; cpu_pct: number; os_version: string; gpu: { name: string; used_mb: number; total_mb: number } | null }>("get_system_stats");
      setMemPct(s.memory_pct);
      setCpuPct(s.cpu_pct);
      setOsVer(s.os_version);
      if (s.gpu) { setGpuName(s.gpu.name); setGpuUsedMb(s.gpu.used_mb); setGpuTotalMb(s.gpu.total_mb); }
    } catch {}
  }, 5000);

  useInterval(async () => {
    try {
      const [ok64, ok32] = await Promise.all([
        invoke<boolean>("bridge64_health").catch(() => false),
        invoke<boolean>("bridge32_health").catch(() => false),
      ]);
      setB64(ok64); setB32(ok32);
    } catch { setB64(false); setB32(false); }
  }, 5000);

  // Initial fetch
  useEffect(() => {
    invoke<{ memory_pct: number; cpu_pct: number; os_version: string; gpu: { name: string; used_mb: number; total_mb: number } | null }>("get_system_stats")
      .then(s => { setMemPct(s.memory_pct); setCpuPct(s.cpu_pct); setOsVer(s.os_version); if (s.gpu) { setGpuName(s.gpu.name); setGpuUsedMb(s.gpu.used_mb); setGpuTotalMb(s.gpu.total_mb); } }).catch(() => {});
    getVersion().then(setVersion).catch(() => {});
    getName().then(setAppName).catch(() => {});
    getTauriVersion().then(setTauriVersion).catch(() => {});
    Promise.all([platform(), arch(), osVersion()])
      .then(([pt, pa, pv]) => { setPlatformType(pt); setPlatformArch(pa); setPlatformVersion(pv); })
      .catch(() => { setPlatformType("windows"); setPlatformArch("x86_64"); setPlatformVersion("unknown"); });
    invoke<boolean>("bridge64_health").catch(() => false).then(setB64);
    invoke<boolean>("bridge32_health").catch(() => false).then(setB32);
  }, []);

  // The Rust side starts with the local control listener down in every
  // process. A persisted `remote.control = true` must re-arm it on every
  // start, otherwise the switch says "on" while nothing is listening. Keyed
  // on the settings load transition so it runs exactly once and does not
  // regenerate the token when the user toggles the switch later.
  const settingsLoaded = settings !== null;
  useEffect(() => {
    if (!settingsLoaded || settings?.["remote.control"] !== true) return;
    invoke("remote_enable", { enabled: true })
      .catch(e => void reportError("remote", "remote_enable on startup failed", String(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settingsLoaded]);

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Box sx={{ height: "100vh", display: "flex", flexDirection: "column", bgcolor: "background.default" }}>
        <TitleBar osVer={osVer} cpuPct={cpuPct} memPct={memPct} gpuName={gpuName} gpuUsedMb={gpuUsedMb} gpuTotalMb={gpuTotalMb} />

        <Box sx={{ flex: 1, display: "flex" }}>
          <Box sx={{ height: "calc(100vh - 48px)", borderRight: 1, borderColor: "divider", bgcolor: "background.paper", display: "flex", flexDirection: "column" }}>
            <Tabs orientation="vertical" value={tab} onChange={(_, v) => setTab(v)}
              sx={{ minWidth: 72, "& .MuiTab-root": { minHeight: 56 } }}>
              <Tab icon={<SpeedIcon />} label={t("app.tabs.speed")} />
              <Tab icon={<SettingsIcon />} label={t("app.tabs.settings")} />
              <Tab icon={<BugReportIcon />} label={t("app.tabs.diagnostics")} />
              <Tab icon={<InfoIcon />} label={t("app.tabs.about")} />
            </Tabs>
            <Box sx={{ flex: 1 }} />

            <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5, px: 1, pb: 0.5 }}>
              <BridgeChip ok={b64} label="B64" />
              <BridgeChip ok={b32} label="B32" />
            </Box>

            <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", pb: 1 }}>
              {darkMode ? <DarkModeIcon sx={{ fontSize: 14, color: "text.secondary" }} /> : <LightModeIcon sx={{ fontSize: 14, color: "text.secondary" }} />}
              <Switch size="small" checked={darkMode} onChange={(_, v) => set("theme", v ? "dark" : "light")} />
            </Box>
          </Box>

          <Box sx={{ width: "calc(100vw - 72px)", display: "flex", flexDirection: "column", overflow: "hidden "}}>
            <Box sx={{ display: tab === 0 ? "flex" : "none", flexDirection: "column", flex: 1, overflow: "hidden" }}>
              <ProcessManager />
            </Box>

            {tab === 1 && <SettingsManager />}

            {tab === 2 && <Diagnostics />}

            {tab === 3 && (
              <Box sx={{ flex: 1, width: "100%", overflow: "auto" }}>
                <Box sx={{ maxWidth: 400, mx: "auto", mt: 8, textAlign: "center", px: 2 }}>
                  <Box component="img" src={appIcon} sx={{ width: 80, height: 80, mb: 1 }} />
                  <Typography
                    variant="h5"
                    sx={{
                      fontWeight: 700,
                      fontStyle: "italic",
                      mb: 4,
                      letterSpacing: 0.25,
                      lineHeight: 1.1,
                      background: darkMode
                        ? "linear-gradient(110deg, #FF4500 0%, #FF8C00 28%, #FFD700 52%, #FF6F00 76%, #E64A19 100%)"
                        : "linear-gradient(110deg, #FF4500 0%, #FF8C00 28%, #FFD700 52%, #FF6F00 76%, #E64A19 100%)",
                      WebkitBackgroundClip: "text",
                      backgroundClip: "text",
                      color: "transparent",
                      textShadow: darkMode
                        ? "1px 1px 0 rgba(230,74,25,0.55), 2px 2px 0 rgba(255,140,0,0.35), 4px 4px 12px rgba(0,0,0,0.32)"
                        : "1px 1px 0 rgba(230,74,25,0.38), 2px 2px 0 rgba(255,140,0,0.24), 4px 4px 10px rgba(0,0,0,0.16)",
                    }}
                  >
                    OpenSpeedy
                  </Typography>

                  <Paper elevation={0} sx={{ p: 2.5, bgcolor: "background.paper", border: 1, borderColor: "divider", textAlign: "left" }}>
                    <Box sx={{ display: "flex", justifyContent: "space-between", py: 1, borderBottom: 1, borderColor: "divider" }}>
                      <Typography variant="body2" sx={{ fontWeight: 600, color: "text.secondary" }}>{t("about.author")}</Typography>
                      <Typography variant="body2">Game1024</Typography>
                    </Box>
                    <Box sx={{ display: "flex", justifyContent: "space-between", py: 1, borderBottom: 1, borderColor: "divider" }}>
                      <Typography variant="body2" sx={{ fontWeight: 600, color: "text.secondary" }}>{t("about.license")}</Typography>
                      <Typography variant="body2">GPL v3</Typography>
                    </Box>
                    <Box sx={{ display: "flex", justifyContent: "space-between", py: 1, borderBottom: 1, borderColor: "divider" }}>
                      <Typography variant="body2" sx={{ fontWeight: 600, color: "text.secondary" }}>{t("about.version")}</Typography>
                      <Typography variant="caption" color="text.secondary" sx={{ fontVariantNumeric: "tabular-nums" }}>{version}</Typography>
                    </Box>
                    <Box sx={{ display: "flex", justifyContent: "space-between", py: 1, borderColor: "divider" }}>
                      <Typography variant="body2" sx={{ fontWeight: 600, color: "text.secondary" }}>{t("about.system")}</Typography>
                      <Typography variant="caption" color="text.secondary">{osVer}</Typography>
                    </Box>


                  </Paper>

                  <Box sx={{ display: "flex", justifyContent: "center", gap: 1, mt: 2 }}>
                    <Button
                      variant="contained"
                      color="primary"
                      startIcon={<ContentCopyIcon />}
                      onClick={handleCopySystemInfo}
                      sx={{ textTransform: "none" }}
                    >
                      {t("about.copyInfo")}
                    </Button>
                    <Button
                      variant="outlined"
                      color="primary"
                      startIcon={<BugReportIcon />}
                      onClick={handleOpenLogs}
                      sx={{ textTransform: "none" }}
                    >
                      {t("about.openLog")}
                    </Button>
                  </Box>

                  <Divider sx={{ mt: 2.5, mb: 2 }}>
                    <Typography variant="caption" color="text.secondary">
                      {t("about.socialLinks")}
                    </Typography>
                  </Divider>

                  <Box sx={{ display: "flex", gap: 1.5, flexWrap: "wrap", justifyContent: "center" }}>
                    <IconButton
                      onClick={() => open("https://store.steampowered.com/app/5010920/OpenSpeedy")}
                      title={t("about.socialSteam")}
                      aria-label={t("about.socialSteam")}
                      sx={{
                        width: 44, height: 44,
                        border: 1, borderColor: "divider",
                        bgcolor: darkMode ? "rgba(255,255,255,0.92)" : "background.paper",
                        "&:hover": { bgcolor: darkMode ? "rgba(255,255,255,0.76)" : "action.hover", borderColor: "primary.main" },
                      }}
                    >
                      <Box component="img" src={steamIcon} sx={{ width: 22, height: 22 }} />
                    </IconButton>
                    <IconButton
                      onClick={() => open("https://space.bilibili.com/426988409")}
                      title={t("about.socialBilibili")}
                      aria-label={t("about.socialBilibili")}
                      sx={{
                        width: 44, height: 44,
                        border: 1, borderColor: "divider",
                        bgcolor: darkMode ? "rgba(255,255,255,0.92)" : "background.paper",
                        "&:hover": { bgcolor: darkMode ? "rgba(255,255,255,0.76)" : "action.hover", borderColor: "primary.main" },
                      }}
                    >
                      <Box component="img" src={bilibiliIcon} sx={{ width: 22, height: 22 }} />
                    </IconButton>
                    <IconButton
                      onClick={() => open("https://github.com/game1024")}
                      title={t("about.socialGithub")}
                      aria-label={t("about.socialGithub")}
                      sx={{
                        width: 44, height: 44,
                        border: 1, borderColor: "divider",
                        bgcolor: darkMode ? "rgba(255,255,255,0.92)" : "background.paper",
                        "&:hover": { bgcolor: darkMode ? "rgba(255,255,255,0.76)" : "action.hover", borderColor: "primary.main" },
                      }}
                    >
                      <Box component="img" src={githubIcon} sx={{ width: 22, height: 22}} />
                    </IconButton>
                    <IconButton
                      onClick={() => open("https://buymeacoffee.com/game1024")}
                      title={t("about.socialBmc")}
                      aria-label={t("about.socialBmc")}
                      sx={{
                        width: 44, height: 44,
                        border: 1, borderColor: "divider",
                        bgcolor: darkMode ? "rgba(255,255,255,0.92)" : "background.paper",
                        "&:hover": { bgcolor: darkMode ? "rgba(255,255,255,0.76)" : "action.hover", borderColor: "primary.main" },
                      }}
                    >
                      <Box component="img" src={bmcIcon} sx={{ width: 22, height: 22 }} />
                    </IconButton>
                  </Box>
                </Box>
              </Box>
            )}
          </Box>
        </Box>
      </Box>
    </ThemeProvider>
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
      sx={{ height: 22, fontSize: "0.65rem" }}
    />
  );
}

export default App;
