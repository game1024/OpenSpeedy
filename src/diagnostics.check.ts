/**
 * Checks for `diagnostics.ts`. Same style as `shortcutProfile.check.ts`: run it
 * with `node src/diagnostics.check.ts` — no test runner, no browser.
 */

import { classify, type DiagEvidence } from "./diagnostics.ts";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

function verdict(evidence: DiagEvidence) {
  return classify(evidence);
}

// ── The three failure modes the stage-0 checklist names ────────────────────

assert(
  verdict({ register: { ok: false, code: 1409 }, fired: false, injectOk: null }) === "not_registered",
  "occupied combination reports not_registered",
);
assert(
  verdict({ register: { ok: false }, fired: false, injectOk: null }) === "not_registered",
  "registration failure without a code is still not_registered",
);
assert(
  verdict({ register: null, fired: false, injectOk: null }) === "not_registered",
  "a probe that never registered anything is not_registered",
);
assert(
  verdict({ register: { ok: true }, fired: false, injectOk: null }) === "registered_no_fire",
  "registered but silent reports registered_no_fire",
);
assert(
  verdict({ register: { ok: true }, fired: true, injectOk: false }) === "fired_no_inject",
  "fired but the bridge refused reports fired_no_inject",
);
assert(
  verdict({ register: { ok: true }, fired: true, injectOk: null }) === "fired_no_inject",
  "an unconfirmed injection is reported as failed, not as success",
);

// ── Ordering ───────────────────────────────────────────────────────────────

assert(
  verdict({ register: { ok: false, code: 1409 }, fired: true, injectOk: false }) === "not_registered",
  "a registration failure outranks everything downstream",
);
assert(
  verdict({ register: { ok: true }, fired: false, injectOk: false }) === "registered_no_fire",
  "no fire is reported before injection, which was never reached",
);

// ── The healthy path ───────────────────────────────────────────────────────

assert(
  verdict({ register: { ok: true }, fired: true, injectOk: true }) === "ok",
  "the full chain reports ok",
);

console.log("diagnostics.check ok");
