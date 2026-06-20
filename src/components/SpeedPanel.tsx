import React from "react";
import { useTranslation } from "react-i18next";
import { Box, Paper, Typography, Slider } from "@mui/material";
import SpeedIcon from "@mui/icons-material/Speed";

// ── Speed mapping: slider [-999, 999] → speed [0.001, 1000], 1× at 0 ──

export function toSpeed(v: number): number {
  if (v <= 0) { return 1 + v * 0.001; }
  else        { return 1 + v; }
}
export function toSlider(s: number): number {
  if (s <= 1.0) return (s - 1) / 0.001;
  else          return s - 1;
}

interface SpeedPanelProps {
  speed: number;
  onChange: (speed: number) => void;
  onCommit: (speed: number) => void;
}

export default React.memo(function SpeedPanel({ speed, onChange, onCommit }: SpeedPanelProps) {
  const { t } = useTranslation();
  return (
    <Paper elevation={0}
      sx={{ mx: 1.5, mt: 1.5, px: 2, pt: 1, pb: 0.5, bgcolor: "background.paper", border: 1, borderColor: "divider" }}>
      <Box sx={{ display: "flex", alignItems: "center", mb: 0.5 }}>
        <SpeedIcon sx={{ color: "secondary.main", fontSize: 20, mr: 1 }} />
        <Typography variant="caption" sx={{ fontWeight: 600, textTransform: "uppercase", letterSpacing: 1, color: "text.secondary" }}>
          {t("speed.title")}
        </Typography>
        <Typography variant="caption" sx={{ ml: 1, fontWeight: 600, color: speed < 0.99 ? "warning.main" : speed > 1.01 ? "secondary.main" : "text.disabled" }}>
          {speed < 0.99 ? t("speed.slow") : speed > 1.01 ? t("speed.fast") : t("speed.normal")}
        </Typography>
      </Box>

      <Box sx={{ display: "flex", justifyContent: "center", mb: 0.5 }}>
        <Typography variant="h4" sx={{
          fontWeight: 800, fontVariantNumeric: "tabular-nums", lineHeight: 1, letterSpacing: -1,
          px: 3, py: 1, borderRadius: 2,
          bgcolor: speed > 1.01 ? "rgba(0,131,143,0.12)" : speed < 0.99 ? "rgba(237,108,2,0.12)" : "rgba(92,107,192,0.10)",
          color: speed > 1.01 ? "secondary.main" : speed < 0.99 ? "warning.main" : "primary.main",
        }}>
          {speed.toFixed(3)}×
        </Typography>
      </Box>

      <Slider
        value={toSlider(speed)}
        onChange={(_, v) => onChange(toSpeed(v as number))}
        onChangeCommitted={(_, v) => onCommit(toSpeed(v as number))}
        min={-999} max={999} step={1}
        valueLabelDisplay="auto"
        valueLabelFormat={v => `${toSpeed(v).toFixed(2)}×`}
        size="small"
        sx={{ color: speed > 1.01 ? "secondary.main" : speed < 0.99 ? "warning.main" : "primary.main" }}
      />

      <Box
        sx={{ textAlign: "center", mt: -0.5, cursor: "pointer", userSelect: "none", "&:hover .reset-label": { color: "primary.main" } }}
        onClick={() => { onChange(1.0); onCommit(1.0); }}
      >
        <Typography className="reset-label" sx={{ color: "text.disabled", fontSize: 10, lineHeight: 1 }}>▲</Typography>
        <Typography className="reset-label" variant="caption" sx={{ color: "text.disabled" }}>{t("speed.reset")}</Typography>
      </Box>
    </Paper>
  );
});
