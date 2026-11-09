import {
  compactValues,
  deleteProfile,
  diffRegistration,
  exeKey,
  PROFILE_NAME_MAX,
  nextProfileName,
  normalizeProfiles,
  previewShortcuts,
  registrationEntries,
  registrationSignature,
  resolveShortcuts,
  newlyAddedExes,
  speedOverrides,
  upsertProfile,
  validateProfileName,
  type GlobalShortcuts,
  type ShortcutProfile,
  type SpeedValueKey,
} from "./shortcutProfile.ts";

type SpeedValues = Record<SpeedValueKey, number>;

/** Same lookup as useShortcut's speedOf: pinned value first, then the live global. */
function resolveSpeedValues(global: SpeedValues, profiles: ShortcutProfile[], exe: string): SpeedValues {
  return { ...global, ...speedOverrides(profiles, exe) };
}

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

function globals(partial: Partial<GlobalShortcuts>): GlobalShortcuts {
  return {
    increaseSpeedShortcut: "",
    decreaseSpeedShortcut: "",
    resetSpeedShortcut: "",
    gear1Shortcut: "",
    gear2Shortcut: "",
    gear3Shortcut: "",
    gear4Shortcut: "",
    gear5Shortcut: "",
    holdShortcut: "",
    ...partial,
  };
}

const globalKeys = globals({
  increaseSpeedShortcut: "NUMPADADD",
  decreaseSpeedShortcut: "NUMPADSUB",
  resetSpeedShortcut: "Ctrl+Alt+0",
  gear3Shortcut: "Ctrl+Shift+3",
  holdShortcut: "Ctrl+Shift+H",
});

const game: ShortcutProfile = {
  id: "a",
  name: "手柄游戏",
  processes: ["gameA.exe", "gameB.exe"],
  shortcuts: { increaseSpeedShortcut: "Pad:LB+Up" },
};

const resolved = resolveShortcuts(globalKeys, [game], "gameA.exe");
assert(resolved.shortcuts.increaseSpeedShortcut === "Pad:LB+Up", "override increase");
assert(resolved.shortcuts.decreaseSpeedShortcut === "NUMPADSUB", "inherit decrease");
assert(resolved.shortcuts.gear3Shortcut === "Ctrl+Shift+3", "inherit gear");
assert(resolved.shortcuts.holdShortcut === "Ctrl+Shift+H", "inherit hold");
assert(resolved.conflicts.length === 0, "no conflict");

const pinned = resolveShortcuts(globals({
  ...globalKeys,
  increaseSpeedShortcut: "Ctrl+1",
}), [{ ...game, shortcuts: { increaseSpeedShortcut: "NUMPADADD" } }], "gameA.exe");
assert(pinned.shortcuts.increaseSpeedShortcut === "NUMPADADD", "explicit copy stays put");

const cleared = previewShortcuts(globalKeys, {});
assert(cleared.shortcuts.increaseSpeedShortcut === "NUMPADADD", "empty overlay inherits");

const other = resolveShortcuts(globalKeys, [game], "notepad.exe");
assert(other.profileId === null && other.shortcuts.increaseSpeedShortcut === "NUMPADADD", "other exe uses global");

const first: ShortcutProfile = {
  id: "1",
  name: "先",
  processes: ["Game.exe"],
  shortcuts: { increaseSpeedShortcut: "Pad:LB+Up" },
};
const second: ShortcutProfile = {
  id: "2",
  name: "后",
  processes: ["C:\\Games\\game.exe", "other.exe"],
  shortcuts: { decreaseSpeedShortcut: "Pad:LB+Down" },
};
const hit = resolveShortcuts(globalKeys, [first, second], "GAME.EXE");
assert(hit.profileId === "1", "earliest profile wins");
assert(hit.shortcuts.increaseSpeedShortcut === "Pad:LB+Up", "first override");
assert(hit.shortcuts.decreaseSpeedShortcut === "NUMPADSUB", "second profile does not merge");
assert(exeKey("C:/Games/Game.exe") === exeKey("game.exe"), "path and case are one exe");

const stripped = upsertProfile([first, second], second);
assert(stripped[1]?.processes.join(",") === "other.exe", "later duplicate exe is stripped on save");
assert(stripped[0]?.processes.join(",") === "Game.exe", "earliest keeps the exe");

assert(validateProfileName("  ", []) === "empty", "blank name");
assert(validateProfileName("x".repeat(PROFILE_NAME_MAX), []) === null, "name at the limit");
assert(validateProfileName(`  ${"x".repeat(PROFILE_NAME_MAX + 1)}  `, []) === "long", "name past the limit");
assert(validateProfileName(" Global ", [], undefined, "Global") === "reserved", "reserved name");
assert(validateProfileName("手柄游戏", [game]) === "duplicate", "duplicate name");
assert(validateProfileName("  手柄游戏  ", [game], "a") === null, "self rename");
const fmt = (n: number) => `Profile ${n}`;
assert(nextProfileName([], fmt) === "Profile 1", "default name");
assert(nextProfileName([{ ...game, name: "Profile 1" }], fmt) === "Profile 2", "next free name");

const store: { settings: { increaseSpeedShortcut: string }; shortcutProfiles: unknown } = {
  settings: { increaseSpeedShortcut: "NUMPADADD" },
  shortcutProfiles: normalizeProfiles([]),
};
assert(JSON.stringify(store.shortcutProfiles) === "[]", "missing profiles load as empty");
store.shortcutProfiles = JSON.parse(JSON.stringify(upsertProfile([], {
  id: "p",
  name: " 手柄游戏 ",
  processes: ["gameA.exe"],
  shortcuts: { increaseSpeedShortcut: "Pad:LB+Up", decreaseSpeedShortcut: "" },
})));
const loaded = normalizeProfiles(store.shortcutProfiles);
assert(loaded.length === 1, "one profile roundtrips");
assert(loaded[0]?.name === "手柄游戏", "name trimmed");
assert(loaded[0]?.shortcuts.increaseSpeedShortcut === "Pad:LB+Up", "filled slot roundtrips");
assert(loaded[0]?.shortcuts.decreaseSpeedShortcut === "", "explicit clear is stored");
const mutedHit = resolveShortcuts(globalKeys, loaded, "gameA.exe");
assert(mutedHit.shortcuts.decreaseSpeedShortcut === "", "cleared slot does not inherit");
assert(!registrationEntries(mutedHit).some(entry => entry.shortcut === "NUMPADSUB"), "cleared slot is not registered");
assert(store.settings.increaseSpeedShortcut === "NUMPADADD", "global settings stay put");
assert(deleteProfile(loaded, "p").length === 0, "delete removes the profile");

const before = registrationEntries(resolveShortcuts(globalKeys, [], ""));
const after = registrationEntries(resolved);
const same = diffRegistration(before, before);
assert(same.remove.length === 0 && same.add.length === 0, "same list does not reregister");
const retry = diffRegistration(before.filter(entry => entry.shortcut !== "NUMPADADD"), before);
assert(retry.add.length === 1 && retry.add[0]?.shortcut === "NUMPADADD" && retry.remove.length === 0, "failed chord is retried alone");
const changed = diffRegistration(before, after);
assert(changed.remove.includes("NUMPADADD"), "replaced global key is removed");
assert(changed.add.some(entry => entry.shortcut === "Pad:LB+Up"), "profile key is added");
assert(!changed.remove.includes("NUMPADSUB") && !changed.add.some(entry => entry.shortcut === "NUMPADSUB"), "inherited key stays");

const collided = registrationEntries(previewShortcuts(globalKeys, { increaseSpeedShortcut: "NUMPADSUB" }));
const collidedSub = collided.find(entry => entry.shortcut === "NUMPADSUB");
assert(collidedSub?.conflict === true, "conflict chord stays registered");
assert(collided.filter(entry => entry.shortcut === "NUMPADSUB").length === 1, "conflict chord is registered once");

const steps: SpeedValues = {
  increaseSpeedStep: 1,
  decreaseSpeedStep: 0.5,
  gear1Speed: 1,
  gear2Speed: 2,
  gear3Speed: 5,
  gear4Speed: 10,
  gear5Speed: 100,
  holdSpeed: 2,
};
const stepped: ShortcutProfile = { ...game, values: { increaseSpeedStep: 3 } };
const steppedHit = resolveSpeedValues(steps, [stepped], "gameA.exe");
assert(steppedHit.increaseSpeedStep === 3, "override increase step");
assert(steppedHit.decreaseSpeedStep === 0.5, "inherit decrease step");
assert(steppedHit.gear3Speed === 5 && steppedHit.holdSpeed === 2, "inherit gear and hold");
const pinnedStep = resolveSpeedValues(
  { ...steps, increaseSpeedStep: 2 },
  [{ ...game, values: { increaseSpeedStep: 1 } }],
  "gameA.exe",
);
assert(pinnedStep.increaseSpeedStep === 1, "explicit step stays put");

const dirty = normalizeProfiles([{
  id: "d",
  name: "脏",
  processes: ["d.exe"],
  shortcuts: {},
  values: { increaseSpeedStep: 11, decreaseSpeedStep: 0.05, gear1Speed: "nope", holdSpeed: Number.NaN, gear2Speed: 4 },
}]);
assert(dirty[0]?.values?.increaseSpeedStep === undefined, "increase above 10 dropped");
assert(dirty[0]?.values?.decreaseSpeedStep === undefined, "decrease below 0.1 dropped");
assert(dirty[0]?.values?.gear1Speed === undefined, "non-numeric dropped");
assert(dirty[0]?.values?.holdSpeed === undefined, "non-finite dropped");
assert(dirty[0]?.values?.gear2Speed === 4, "in-range gear kept");
assert(compactValues({ increaseSpeedStep: 0.1, holdSpeed: 100 }).increaseSpeedStep === 0.1, "lower bound kept");
assert(compactValues({ increaseSpeedStep: 10 }).increaseSpeedStep === 10, "upper bound kept");

const legacy = normalizeProfiles([{
  id: "old",
  name: "旧",
  processes: ["old.exe"],
  shortcuts: { increaseSpeedShortcut: "A" },
}]);
const inherited = resolveSpeedValues(steps, legacy, "old.exe");
assert(
  (Object.keys(steps) as (keyof SpeedValues)[]).every(key => inherited[key] === steps[key]),
  "legacy inherits all eight",
);

const withValue = upsertProfile([], { ...game, values: { increaseSpeedStep: 1 } });
const resaved = upsertProfile(withValue, {
  ...withValue[0]!,
  shortcuts: { increaseSpeedShortcut: "Pad:LB+Down" },
});
assert(resaved[0]?.values?.increaseSpeedStep === 1, "shortcut save keeps step");
assert(resaved[0]?.shortcuts.increaseSpeedShortcut === "Pad:LB+Down", "shortcut updated");

const sameChord = { increaseSpeedShortcut: "NUMPADADD" } as const;
const stepOne: ShortcutProfile = { ...game, id: "s1", processes: ["one.exe"], shortcuts: sameChord, values: { increaseSpeedStep: 1 } };
const stepThree: ShortcutProfile = { ...game, id: "s3", processes: ["three.exe"], shortcuts: sameChord, values: { increaseSpeedStep: 3 } };
const listOne = registrationEntries(resolveShortcuts(globalKeys, [stepOne, stepThree], "one.exe"));
const listThree = registrationEntries(resolveShortcuts(globalKeys, [stepOne, stepThree], "three.exe"));
assert(registrationSignature(listOne) === registrationSignature(listThree), "same shortcuts do not reregister");
assert(resolveSpeedValues(steps, [stepOne, stepThree], "one.exe").increaseSpeedStep === 1, "foreground one uses step 1");
assert(resolveSpeedValues(steps, [stepOne, stepThree], "three.exe").increaseSpeedStep === 3, "foreground three uses step 3");
assert(resolveSpeedValues({ ...steps, decreaseSpeedStep: 0.8 }, [stepOne], "one.exe").decreaseSpeedStep === 0.8, "unset step follows live global");

const kept = newlyAddedExes(
  [{ ...game, processes: ["Game.exe"] }],
  [{ ...game, processes: ["game.exe", "New.exe"] }],
);
assert(kept.length === 1 && kept[0] === "New.exe", "only the new exe is enabled");
assert(newlyAddedExes([{ ...game, processes: ["a.exe"] }], []).length === 0, "removing a profile does not list exes");

console.log("shortcutProfile.check ok");
