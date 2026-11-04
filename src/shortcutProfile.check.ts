import {
  deleteProfile,
  diffRegistration,
  exeKey,
  nextProfileName,
  normalizeProfiles,
  previewShortcuts,
  registrationEntries,
  resolveShortcuts,
  upsertProfile,
  validateProfileName,
  type GlobalShortcuts,
  type ShortcutProfile,
} from "./shortcutProfile.ts";

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
assert(validateProfileName(" 全局 ", []) === "reserved", "reserved name");
assert(validateProfileName("手柄游戏", [game]) === "duplicate", "duplicate name");
assert(validateProfileName("  手柄游戏  ", [game], "a") === null, "self rename");
assert(nextProfileName([]) === "配置 1", "default name");
assert(nextProfileName([{ ...game, name: "配置 1" }]) === "配置 2", "next free name");

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
assert(loaded[0]?.shortcuts.decreaseSpeedShortcut === undefined, "empty slot is not stored");
assert(store.settings.increaseSpeedShortcut === "NUMPADADD", "global settings stay put");
assert(deleteProfile(loaded, "p").length === 0, "delete removes the profile");

const before = registrationEntries(resolveShortcuts(globalKeys, [], ""));
const after = registrationEntries(resolved);
const same = diffRegistration(before, before);
assert(same.unchanged && same.remove.length === 0 && same.add.length === 0, "same list does not reregister");
const changed = diffRegistration(before, after);
assert(changed.remove.includes("NUMPADADD"), "replaced global key is removed");
assert(changed.add.some(entry => entry.shortcut === "Pad:LB+Up"), "profile key is added");
assert(!changed.remove.includes("NUMPADSUB") && !changed.add.some(entry => entry.shortcut === "NUMPADSUB"), "inherited key stays");

const collided = registrationEntries(previewShortcuts(globalKeys, { increaseSpeedShortcut: "NUMPADSUB" }));
const collidedSub = collided.find(entry => entry.shortcut === "NUMPADSUB");
assert(collidedSub?.conflict === true, "conflict chord stays registered");
assert(collided.filter(entry => entry.shortcut === "NUMPADSUB").length === 1, "conflict chord is registered once");

console.log("shortcutProfile.check ok");
