/**
 * Diagnostics page (stage 0).
 *
 * Two jobs, both read-only with respect to games:
 *   1. show whether each configured hotkey is actually registered — the state
 *      that used to fail silently;
 *   2. run a one-press check that names which step of the chain breaks:
 *      registration → callback → injection.
 *
 * The probe borrows the app's own suspend/resume path (the same one the
 * shortcut fields use), so the shortcut table is restored exactly as it was
 * when the check finishes, times out, or the page is closed.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Alert, Box, Button, Chip, Divider, MenuItem, Paper, Select, Switch,
  Table, TableBody, TableCell, TableHead, TableRow, Typography,
} from "@mui/material";
import * as GlobalShortcut from "@tauri-apps/plugin-global-shortcut";
import { invoke } from "@tauri-apps/api/core";
import { useSettings } from "../hooks/useSettings";
import {
  isGamepadShortcut,
  resumeShortcuts,
  shortcutLabel,
  suspendShortcuts,
  traceInput,
  useShortcut,
} from "../hooks/useShortcut";
import { SHORTCUT_SLOTS, type ShortcutSlot } from "../shortcutProfile";
import { classify, type DiagVerdict } from "../diagnostics";

/** How long the armed probe waits for the callback. */
const FIRE_WINDOW_MS = 3000;

type ProbePhase = "idle" | "probing" | "done";

/** Status row wording + colour, shared by the table below. */
function stateOf(chord: string, status: boolean | undefined) {
  if (!chord) return { key: "diag.stateEmpty", color: "default" as const };
  if (isGamepadShortcut(chord)) return { key: "diag.stateGamepad", color: "default" as const };
  if (status === true) return { key: "diag.stateOk", color: "success" as const };
  if (status === false) return { key: "diag.stateFail", color: "error" as const };
  return { key: "diag.statePending", color: "default" as const };
}

export default function Diagnostics() {
  const { t } = useTranslation();
  const { settings, set } = useSettings();
  const { shortcutStatus } = useShortcut();

  const [slot, setSlot] = useState<ShortcutSlot>("increaseSpeedShortcut");
  const [phase, setPhase] = useState<ProbePhase>("idle");
  const [armed, setArmed] = useState(false);
  const [probe, setProbe] = useState("");
  const [verdict, setVerdict] = useState<DiagVerdict | null>(null);
  const [code, setCode] = useState<number | null>(null);

  // The callback fires from the OS message loop, outside React, so everything
  // it touches is a ref. `phaseRef` exists because a state update is not
  // readable from that callback before the next render.
  const phaseRef = useRef<ProbePhase>("idle");
  const firedRef = useRef(false);
  const registeredRef = useRef<string | null>(null);
  const suspendedRef = useRef(false);
  const activeRef = useRef(false);
  const concludingRef = useRef(false);
  const timerRef = useRef<number | undefined>(undefined);
  // Resolved slot for the next check; assigned during render once the list of
  // testable slots is known.
  const targetRef = useRef<ShortcutSlot | null>(null);

  const observe = settings?.["input.observe"] === true;
  const retry = settings?.["hotkey.retry"] === true;
  const polling = settings?.["input.polling"] === true;
  const compat = settings?.["input.compat"] === true;
  const rustDispatch = settings?.["dispatch.rust"] === true;
  const guardWarnOnly = settings?.["guard.warn_only"] === true;

  const moveTo = useCallback((next: ProbePhase) => {
    phaseRef.current = next;
    setPhase(next);
  }, []);

  // Read through a function so the compiler keeps re-reading the ref instead of
  // narrowing it once and treating a later assignment as impossible.
  const isProbing = useCallback(() => phaseRef.current === "probing", []);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== undefined) {
      window.clearTimeout(timerRef.current);
      timerRef.current = undefined;
    }
  }, []);

  /** Drop the probe registration and hand the shortcut table back. Safe to
   *  call twice — every step checks its own flag first. */
  const teardown = useCallback(async () => {
    activeRef.current = false;
    clearTimer();
    const registered = registeredRef.current;
    registeredRef.current = null;
    if (registered) {
      try {
        await GlobalShortcut.unregister(registered);
      } catch {
        // Already gone (the plugin dropped it, or the window is closing).
      }
    }
    if (suspendedRef.current) {
      suspendedRef.current = false;
      try {
        await resumeShortcuts();
      } catch {
        // The registration chain recovers on the next foreground change.
      }
    }
  }, [clearTimer]);

  const chordOf = useCallback(
    (target: ShortcutSlot) => String(settings?.[target] ?? ""),
    [settings],
  );

  const conclude = useCallback(async (fired: boolean) => {
    // The fire callback and the 3-second timer can both land here; only the
    // first one counts, and only while the probe is still the active phase.
    if (concludingRef.current || !isProbing()) return;
    concludingRef.current = true;
    activeRef.current = false;
    clearTimer();

    let injectOk: boolean | null = null;
    if (fired) {
      // `SETSPEED` answers OK even when nothing is injected, so it cannot prove
      // the last hop. The per-process flag is the same read-only signal the
      // speed panel already uses: a process reports `on` only while it is
      // actually patched, which is exactly "a speed change would land here".
      const pids = await invoke<{ pid: number }[]>("get_process_list_fast")
        .then(list => list.map(proc => proc.pid))
        .catch(() => [] as number[]);
      injectOk = pids.length === 0
        ? false
        : await invoke<{ state: string }[]>("probe_acceleration", { pids })
          .then(probes => probes.some(probe => probe.state === "on"))
          .catch(() => false);
    }

    setVerdict(classify({
      register: registeredRef.current ? { ok: true } : { ok: false },
      fired,
      injectOk,
    }));
    moveTo("done");
    setArmed(false);
    await teardown();
    concludingRef.current = false;
  }, [clearTimer, isProbing, moveTo, teardown]);

  const startProbe = useCallback(async () => {
    if (isProbing()) return;
    // The select may have fallen back to the first testable slot, so read the
    // resolved target instead of the raw selection.
    const target = targetRef.current;
    if (!target) return;
    const chord = chordOf(target);
    if (!chord || isGamepadShortcut(chord)) return;

    await teardown();
    concludingRef.current = false;
    firedRef.current = false;
    setVerdict(null);
    setCode(null);
    setArmed(false);
    setProbe(chord);
    moveTo("probing");

    const pending = suspendShortcuts();
    // The counter inside `suspendShortcuts` is bumped before it settles, so the
    // ref has to follow immediately — otherwise a rejection would leave every
    // hotkey suspended with nothing to resume them.
    suspendedRef.current = true;
    try {
      // Same path the shortcut fields use: drop every chord first, otherwise
      // the probe would collide with the app's own registration.
      await pending;
    } catch {
      // Without the suspension the probe cannot own the chord; reporting a
      // registration failure is accurate, and teardown still restores what it
      // can.
      setVerdict(classify({ register: { ok: false }, fired: false, injectOk: null }));
      moveTo("done");
      await teardown();
      return;
    }

    // Cancelled while the table was being suspended: nothing was registered, so
    // only the resume is owed.
    if (!isProbing()) {
      await teardown();
      return;
    }

    activeRef.current = true;
    try {
      await GlobalShortcut.register(chord, () => {
        if (!activeRef.current || firedRef.current) return;
        firedRef.current = true;
        traceInput("hotkey_fired", { slot: "diagnostic", channel: "hotkey" });
        void conclude(true);
      });
      registeredRef.current = chord;
      // A cancel can land while the registration is in flight; the chord is
      // real either way, so it still has to be released.
      if (!isProbing()) {
        await teardown();
        return;
      }
      setArmed(true);
      timerRef.current = window.setTimeout(() => { void conclude(false); }, FIRE_WINDOW_MS);
    } catch (e) {
      if (!isProbing()) {
        await teardown();
        return;
      }
      const text = e instanceof Error ? e.message : String(e);
      const occupied = /already|in use/i.test(text);
      setCode(occupied ? 1409 : null);
      setVerdict(classify({
        register: { ok: false, code: occupied ? 1409 : undefined },
        fired: false,
        injectOk: null,
      }));
      moveTo("done");
      await teardown();
    }
  }, [chordOf, conclude, isProbing, moveTo, teardown]);

  const cancelProbe = useCallback(async () => {
    if (!isProbing()) return;
    activeRef.current = false;
    clearTimer();
    moveTo("idle");
    setArmed(false);
    setProbe("");
    await teardown();
  }, [clearTimer, isProbing, moveTo, teardown]);

  // Closing the page mid-check must not leave the shortcut table suspended.
  useEffect(() => () => { void teardown(); }, [teardown]);

  if (!settings) {
    return (
      <Box sx={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <Typography color="text.disabled">{t("settings.loading")}</Typography>
      </Box>
    );
  }

  const labels: Record<ShortcutSlot, string> = {
    increaseSpeedShortcut: t("settings.increase"),
    decreaseSpeedShortcut: t("settings.decrease"),
    resetSpeedShortcut: t("settings.reset"),
    gear1Shortcut: `${t("settings.gear")} 1`,
    gear2Shortcut: `${t("settings.gear")} 2`,
    gear3Shortcut: `${t("settings.gear")} 3`,
    gear4Shortcut: `${t("settings.gear")} 4`,
    gear5Shortcut: `${t("settings.gear")} 5`,
    holdShortcut: t("settings.hold"),
  };

  // Only chords that go through RegisterHotKey can be probed here; a gamepad
  // binding never reaches the OS table, so it cannot fail that way.
  const testable = SHORTCUT_SLOTS.filter(target => {
    const chord = chordOf(target);
    return !!chord && !isGamepadShortcut(chord);
  });
  const testSlot = testable.includes(slot) ? slot : (testable[0] ?? null);
  targetRef.current = testSlot;

  return (
    <Box sx={{ height: "calc(100vh - 48px)", overflow: "auto", px: 1.5, pb: 2 }}>
      <Paper elevation={0} sx={{ mt: 2, p: 2, bgcolor: "background.paper", border: 1, borderColor: "divider" }}>
        <Typography variant="subtitle2" sx={{ fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5, color: "text.secondary" }}>
          {t("diag.title")}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          {t("diag.intro")}
        </Typography>

        <Box sx={{ display: "flex", alignItems: "center", gap: 1, mt: 1.5 }}>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="body2" sx={{ fontWeight: 600 }}>{t("diag.observe")}</Typography>
            <Typography variant="caption" color="text.disabled">{t("diag.observeHint")}</Typography>
          </Box>
          <Switch
            checked={observe}
            disabled={phase === "probing"}
            onChange={(_, on) => { void set("input.observe", on); }}
          />
        </Box>

        <Box sx={{ display: "flex", alignItems: "center", gap: 1, mt: 1 }}>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="body2" sx={{ fontWeight: 600 }}>{t("diag.retry")}</Typography>
            <Typography variant="caption" color="text.disabled">{t("diag.retryHint")}</Typography>
          </Box>
          <Switch
            checked={retry}
            onChange={(_, on) => { void set("hotkey.retry", on); }}
          />
        </Box>

        <Box sx={{ display: "flex", alignItems: "center", gap: 1, mt: 1 }}>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="body2" sx={{ fontWeight: 600 }}>{t("diag.rustDispatch")}</Typography>
            <Typography variant="caption" color="text.disabled">{t("diag.rustDispatchHint")}</Typography>
          </Box>
          <Switch
            checked={rustDispatch}
            onChange={(_, on) => { void set("dispatch.rust", on); }}
          />
        </Box>

        <Box sx={{ display: "flex", alignItems: "center", gap: 1, mt: 1 }}>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="body2" sx={{ fontWeight: 600 }}>{t("diag.guardWarnOnly")}</Typography>
            <Typography variant="caption" color="text.disabled">{t("diag.guardWarnOnlyHint")}</Typography>
          </Box>
          <Switch
            checked={guardWarnOnly}
            onChange={(_, on) => { void set("guard.warn_only", on); }}
          />
        </Box>

        <Box sx={{ display: "flex", alignItems: "center", gap: 1, mt: 1 }}>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="body2" sx={{ fontWeight: 600 }}>{t("diag.polling")}</Typography>
            <Typography variant="caption" color="text.disabled">{t("diag.pollingHint")}</Typography>
          </Box>
          <Switch
            checked={polling}
            onChange={(_, on) => { void set("input.polling", on); }}
          />
        </Box>

        {polling && (
          <>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1, mt: 1 }}>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="body2" sx={{ fontWeight: 600 }}>{t("diag.compat")}</Typography>
                <Typography variant="caption" color="text.disabled">{t("diag.compatHint")}</Typography>
              </Box>
              <Switch
                checked={compat}
                onChange={(_, on) => { void set("input.compat", on); }}
              />
            </Box>
            <Typography variant="caption" color="text.disabled" sx={{ display: "block", mt: 0.5 }}>
              {t("diag.pollingNote")}
            </Typography>
          </>
        )}

        <Divider sx={{ my: 2 }} />

        <Typography variant="body2" sx={{ fontWeight: 600, mb: 0.5 }}>{t("diag.statusTitle")}</Typography>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell sx={{ border: "none" }}>{t("diag.slot")}</TableCell>
              <TableCell sx={{ border: "none" }}>{t("diag.chord")}</TableCell>
              <TableCell sx={{ border: "none" }}>{t("diag.state")}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {SHORTCUT_SLOTS.map(target => {
              const chord = chordOf(target);
              const state = stateOf(chord, chord ? shortcutStatus[chord] : undefined);
              return (
                <TableRow key={target}>
                  <TableCell sx={{ border: "none" }}>{labels[target]}</TableCell>
                  <TableCell sx={{ border: "none", color: chord ? "text.primary" : "text.disabled" }}>
                    {chord ? shortcutLabel(chord) : t("diag.stateEmpty")}
                  </TableCell>
                  <TableCell sx={{ border: "none" }}>
                    <Chip size="small" color={state.color} label={t(state.key)} sx={{ height: 20, fontSize: "0.72rem" }} />
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>

        <Divider sx={{ my: 2 }} />

        <Typography variant="body2" sx={{ fontWeight: 600, mb: 0.5 }}>{t("diag.testTitle")}</Typography>
        {!observe ? (
          <Typography variant="body2" color="text.secondary">{t("diag.testNeedsObserve")}</Typography>
        ) : testable.length === 0 ? (
          <Typography variant="body2" color="text.secondary">{t("diag.testNoChord")}</Typography>
        ) : (
          <>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap", mt: 0.5 }}>
              <Select
                size="small"
                value={testSlot ?? ""}
                disabled={phase === "probing"}
                onChange={e => setSlot(e.target.value as ShortcutSlot)}
                sx={{ minWidth: 170 }}
              >
                {testable.map(target => (
                  <MenuItem key={target} value={target}>{labels[target]}</MenuItem>
                ))}
              </Select>
              {phase === "probing" ? (
                <Button size="small" variant="outlined" onClick={() => { void cancelProbe(); }}>
                  {t("diag.testCancel")}
                </Button>
              ) : (
                <Button size="small" variant="contained" onClick={() => { void startProbe(); }}>
                  {t("diag.testStart")}
                </Button>
              )}
              {phase === "probing" && (
                <Typography variant="body2" color="text.secondary">
                  {armed
                    ? t("diag.testPressNow", { shortcut: shortcutLabel(probe) })
                    : t("diag.preparing")}
                </Typography>
              )}
            </Box>

            {verdict && (
              <Alert severity={verdict === "ok" ? "success" : "error"} sx={{ mt: 1.5 }}>
                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                  {t(`diag.verdict.${verdict}`)}
                </Typography>
                <Typography variant="caption" sx={{ display: "block" }}>
                  {t(`diag.verdictHint.${verdict}`)}
                </Typography>
                {code === 1409 && (
                  <Typography variant="caption" sx={{ display: "block" }}>{t("diag.occupiedCode")}</Typography>
                )}
                {verdict === "not_registered" && (
                  <Typography variant="caption" sx={{ display: "block", mt: 0.5 }}>
                    {t("diag.gamepadHint")}
                  </Typography>
                )}
              </Alert>
            )}
            <Typography variant="caption" color="text.disabled" sx={{ display: "block", mt: 1 }}>
              {t("diag.logHint")}
            </Typography>
          </>
        )}
      </Paper>
    </Box>
  );
}
