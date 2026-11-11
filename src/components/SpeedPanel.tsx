import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { Box, Paper, Typography, Slider, ButtonBase } from "@mui/material";
import SpeedIcon from "@mui/icons-material/Speed";
// ── Logarithmic speed mapping: slider [-3, 3] → speed [0.001, 1000] ──
// speed = 10^v, so 0 = 1× and every whole step is a factor of ten.
const SLIDER_MIN = -3;
const SLIDER_MAX = 3;
const SLIDER_STEP = 0.01;

export function toSpeed(v: number): number {
  return Math.pow(10, v);
}
export function toSlider(s: number): number {
  return Math.log10(s);
}
/** MUI reports `number | number[]`; this slider is always single-valued. */
function scalar(v: number | number[]): number {
  return typeof v === "number" ? v : (v[0] ?? 0);
}

interface SpeedPanelProps {
  speed: number;
  gears: number[];
  onChange: (speed: number) => void;
  onCommit: (speed: number) => void;
}

export default React.memo(function SpeedPanel({ speed, gears, onChange, onCommit }: SpeedPanelProps) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [editVal, setEditVal] = useState("");

    const active = (g: number) => Math.abs(speed - g) < 0.001;
  const speedColor = speed > 1.01 ? "secondary.main" : speed < 0.99 ? "warning.main" : "primary.main";

  function beginEdit() {
    setEditVal(speed.toFixed(3));
    setEditing(true);
  }

  function commitEdit() {
    const v = parseFloat(editVal);
    if (!isNaN(v) && v >= 0.001 && v <= 1000) {
      onChange(v);
      onCommit(v);
    }
    setEditing(false);
  }

  function cancelEdit() {
    setEditing(false);
  }

  return (
    <Paper elevation={0}
      sx={{ mx: 1.5, mt: 1.5, bgcolor: "background.paper", border: 1, borderColor: "divider" }}>

      {/* ── Header ── */}
      <Box sx={{ display: "flex", alignItems: "center", px: 2, pt: 1.5, pb: 1 }}>
        <SpeedIcon sx={{ color: "secondary.main", fontSize: 20, mr: 1 }} />
        <Typography variant="subtitle2" sx={{ fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5 }}>
          {t("speed.title")}
        </Typography>
        <Box sx={{ flex: 1 }} />
        <Typography variant="caption" sx={{
          fontWeight: 600, px: 1.2, py: 0.3, borderRadius: 1,
          bgcolor: speed > 1.01 ? "rgba(0,131,143,0.12)" : speed < 0.99 ? "rgba(237,108,2,0.12)" : "rgba(92,107,192,0.10)",
          color: speedColor,
        }}>
          {speed < 0.99 ? t("speed.slow") : speed > 1.01 ? t("speed.fast") : t("speed.normal")}
        </Typography>
      </Box>

      {/* ── Speed display + slider ── */}
      <Box sx={{ px: 2, pb: 1 }}>
        {/* ── Speed display (click to edit) ── */}
        {editing ? (
          <Box sx={{ textAlign: "center", mb: 0.5 }}>
            <input
              autoFocus
              value={editVal}
              onChange={e => setEditVal(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") commitEdit(); if (e.key === "Escape") cancelEdit(); }}
              onBlur={commitEdit}
              style={{
                width: 120, textAlign: "center", fontSize: "2rem", fontWeight: 800,
                fontVariantNumeric: "tabular-nums", border: "none", borderBottom: `2px solid ${speedColor}`,
                outline: "none", background: "transparent", color: "inherit",
              }}
            />
            <Typography variant="caption" sx={{ display: "block", mt: 0.3, color: "text.disabled" }}>
              ⏎ Enter {t("speed.confirm")}
            </Typography>
          </Box>
        ) : (
          <Box onClick={beginEdit} sx={{ cursor: "text", textAlign: "center", mb: 0.5 }}>
            <Typography variant="h3" sx={{
              fontWeight: 800, fontVariantNumeric: "tabular-nums", lineHeight: 1,
              color: speedColor, display: "inline",
            }}>
              {speed.toFixed(3)}
            </Typography>
            <Typography component="span" variant="h5" sx={{ fontWeight: 600, color: "text.secondary", display: "inline" }}>×</Typography>
          </Box>
        )}

        <Box sx={{ display: "flex", justifyContent: "center", mb: 0.5, }}>
          <Slider
            value={toSlider(speed)}
            onChange={(_, v) => onChange(toSpeed(scalar(v)))}
            onChangeCommitted={(_, v) => onCommit(toSpeed(scalar(v)))}
            min={SLIDER_MIN} max={SLIDER_MAX} step={SLIDER_STEP}
            marks={[
              { value: -3, label: "0.001" },
              { value: -2, label: "0.01" },
              { value: -1, label: "0.1" },
              { value: 0, label: "1×" },
              { value: 1, label: "10" },
              { value: 2, label: "100" },
              { value: 3, label: "1000" },
            ]}
            valueLabelFormat={v => toSpeed(v).toFixed(3)}
            size="small"
            sx={{ color: speedColor, width: "88%" }}
          />
        </Box>
      </Box>

      {/* ── Reset ── */}
      <Box
        sx={{ textAlign: "center", mb: 0.5, cursor: "pointer", userSelect: "none", "&:hover .reset-label": { color: "primary.main" } }}
        onClick={() => { onChange(1.0); onCommit(1.0); }}
      >
        <Typography className="reset-label" sx={{ color: "text.disabled", fontSize: 10, lineHeight: 1 }}>▲</Typography>
        <Typography className="reset-label" variant="caption" sx={{ color: "text.disabled" }}>{t("speed.reset")}</Typography>
      </Box>

      {/* ── Gear buttons ── */}
      <Box sx={{ display: "flex", alignItems: "stretch", borderTop: 1, borderColor: "divider" }}>
        {gears.filter(g => g > 0).map((g, i) => (
          <ButtonBase
            key={i}
            onClick={() => { onChange(g); onCommit(g); }}
            sx={{
              flex: 1, py: 1, flexDirection: "column", minWidth: 0,
              borderRight: i < gears.filter(Boolean).length - 1 ? 1 : 0,
              borderColor: "divider",
              bgcolor: active(g) ? (speed > 1.01 ? "rgba(0,131,143,0.08)" : speed < 0.99 ? "rgba(237,108,2,0.08)" : "rgba(92,107,192,0.06)") : "transparent",
              "&:hover": { bgcolor: "action.hover" },
            }}
          >
            <Typography variant="caption" sx={{
              fontWeight: 700, fontSize: "0.75rem",
              color: active(g) ? speedColor : "text.secondary",
            }}>
              {g.toFixed(g < 10 ? 1 : 0)}×
            </Typography>
            <Typography variant="caption" sx={{ fontSize: "0.55rem", color: "text.disabled" }}>
              G{i + 1}
            </Typography>
          </ButtonBase>
        ))}
      </Box>
    </Paper>
  );
});
