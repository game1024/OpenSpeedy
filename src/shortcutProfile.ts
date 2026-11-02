/** Nine speed-shortcut slots. Empty in a profile means inherit the global value. */

export const SHORTCUT_SLOTS = [
  "increaseSpeedShortcut",
  "decreaseSpeedShortcut",
  "resetSpeedShortcut",
  "gear1Shortcut",
  "gear2Shortcut",
  "gear3Shortcut",
  "gear4Shortcut",
  "gear5Shortcut",
  "holdShortcut",
] as const;

export type ShortcutSlot = (typeof SHORTCUT_SLOTS)[number];
export type GlobalShortcuts = Record<ShortcutSlot, string>;

/** Inclusive bounds, same as the global number fields. Missing key means inherit. */
export const SPEED_VALUE_BOUNDS = {
  increaseSpeedStep: [0.1, 10],
  decreaseSpeedStep: [0.1, 100],
  gear1Speed: [0.01, 100],
  gear2Speed: [0.01, 100],
  gear3Speed: [0.01, 100],
  gear4Speed: [0.01, 100],
  gear5Speed: [0.01, 100],
  holdSpeed: [0.01, 100],
} as const;

export type SpeedValueKey = keyof typeof SPEED_VALUE_BOUNDS;
export type SpeedValues = Record<SpeedValueKey, number>;

const SPEED_VALUE_KEYS = Object.keys(SPEED_VALUE_BOUNDS) as SpeedValueKey[];

export interface ShortcutProfile {
  id: string;
  name: string;
  processes: string[];
  shortcuts: Partial<Record<ShortcutSlot, string>>;
  values?: Partial<Record<SpeedValueKey, number>>;
}

export type NameError = "empty" | "duplicate" | "reserved";

export function exeBase(name: string): string {
  const trimmed = name.trim();
  const parts = trimmed.split(/[/\\]/);
  return parts[parts.length - 1] ?? "";
}

export function exeKey(name: string): string {
  return exeBase(name).toLowerCase();
}

export function globalShortcuts(source: object): GlobalShortcuts {
  const record = source as Record<string, unknown>;
  const out = {} as GlobalShortcuts;
  for (const slot of SHORTCUT_SLOTS) {
    const value = record[slot];
    out[slot] = typeof value === "string" ? value : "";
  }
  return out;
}

export function validateProfileName(
  name: string,
  profiles: readonly ShortcutProfile[],
  selfId?: string,
  reservedLabel?: string,
): NameError | null {
  const trimmed = name.trim();
  if (!trimmed) return "empty";
  if (reservedLabel && trimmed === reservedLabel.trim()) return "reserved";
  if (profiles.some(p => p.id !== selfId && p.name.trim() === trimmed)) return "duplicate";
  return null;
}

export function nextProfileName(
  profiles: readonly ShortcutProfile[],
  format: (n: number) => string,
): string {
  const used = new Set(profiles.map(p => p.name.trim()));
  let n = 1;
  while (used.has(format(n))) n++;
  return format(n);
}

export function compactShortcuts(
  input: Partial<Record<ShortcutSlot, string>> | undefined,
): Partial<Record<ShortcutSlot, string>> {
  const out: Partial<Record<ShortcutSlot, string>> = {};
  if (!input) return out;
  for (const slot of SHORTCUT_SLOTS) {
    const value = input[slot];
    if (typeof value === "string" && value.trim()) out[slot] = value;
  }
  return out;
}

export function compactValues(
  input: Partial<Record<SpeedValueKey, unknown>> | undefined,
): Partial<Record<SpeedValueKey, number>> {
  const out: Partial<Record<SpeedValueKey, number>> = {};
  if (!input) return out;
  for (const key of SPEED_VALUE_KEYS) {
    const value = input[key];
    const [min, max] = SPEED_VALUE_BOUNDS[key];
    if (typeof value === "number" && Number.isFinite(value) && value >= min && value <= max) out[key] = value;
  }
  return out;
}

/** Earliest profile keeps each exe. Later copies of the same exe are dropped. */
export function stripDuplicateProcesses(profiles: readonly ShortcutProfile[]): ShortcutProfile[] {
  const seen = new Set<string>();
  return profiles.map(profile => {
    const processes: string[] = [];
    for (const proc of profile.processes) {
      const key = exeKey(proc);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      processes.push(exeBase(proc));
    }
    const same = processes.length === profile.processes.length
      && processes.every((proc, i) => proc === profile.processes[i]);
    return same ? profile : { ...profile, processes };
  });
}

export function normalizeProfiles(raw: unknown): ShortcutProfile[] {
  if (!Array.isArray(raw)) return [];
  const parsed: ShortcutProfile[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    if (typeof row.id !== "string" || !row.id) continue;
    const processes = Array.isArray(row.processes)
      ? row.processes.filter((name): name is string => typeof name === "string")
      : [];
    const rawValues = row.values;
    parsed.push({
      id: row.id,
      name: typeof row.name === "string" ? row.name : "",
      processes,
      shortcuts: compactShortcuts(row.shortcuts as Partial<Record<ShortcutSlot, string>> | undefined),
      values: compactValues(
        rawValues && typeof rawValues === "object"
          ? rawValues as Partial<Record<SpeedValueKey, unknown>>
          : undefined,
      ),
    });
  }
  return stripDuplicateProcesses(parsed);
}

export function upsertProfile(
  profiles: readonly ShortcutProfile[],
  profile: ShortcutProfile,
): ShortcutProfile[] {
  const next: ShortcutProfile = {
    id: profile.id,
    name: profile.name.trim(),
    processes: profile.processes,
    shortcuts: compactShortcuts(profile.shortcuts),
    values: compactValues(profile.values),
  };
  const replaced = profiles.some(p => p.id === next.id)
    ? profiles.map(p => (p.id === next.id ? next : p))
    : [...profiles, next];
  return stripDuplicateProcesses(replaced);
}

export function deleteProfile(profiles: readonly ShortcutProfile[], id: string): ShortcutProfile[] {
  return profiles.filter(p => p.id !== id);
}

export function occupiedBy(
  profiles: readonly ShortcutProfile[],
  exe: string,
  selfId?: string,
): ShortcutProfile | null {
  const key = exeKey(exe);
  if (!key) return null;
  return profiles.find(p => p.id !== selfId && p.processes.some(proc => exeKey(proc) === key)) ?? null;
}

export function profilesOverriding(profiles: readonly ShortcutProfile[], slot: ShortcutSlot): string[] {
  return profiles.filter(p => !!p.shortcuts[slot]).map(p => p.name);
}

export function profilesOverridingValue(profiles: readonly ShortcutProfile[], key: SpeedValueKey): string[] {
  return profiles.filter(p => typeof p.values?.[key] === "number").map(p => p.name);
}

function profileForExe(profiles: readonly ShortcutProfile[], foregroundExe: string): ShortcutProfile | null {
  const key = exeKey(foregroundExe);
  if (!key) return null;
  return profiles.find(p => p.processes.some(proc => exeKey(proc) === key)) ?? null;
}

export interface ResolveResult {
  profileId: string | null;
  shortcuts: GlobalShortcuts;
  conflicts: ShortcutSlot[];
}

export function resolveShortcuts(
  global: GlobalShortcuts,
  profiles: readonly ShortcutProfile[],
  foregroundExe: string,
): ResolveResult {
  const profile = profileForExe(profiles, foregroundExe);
  const shortcuts = {} as GlobalShortcuts;
  for (const slot of SHORTCUT_SLOTS) {
    const override = profile?.shortcuts[slot];
    shortcuts[slot] = override ? override : (global[slot] ?? "");
  }
  return { profileId: profile?.id ?? null, shortcuts, conflicts: conflictingSlots(shortcuts) };
}

export function resolveSpeedValues(
  global: SpeedValues,
  profiles: readonly ShortcutProfile[],
  foregroundExe: string,
): SpeedValues {
  const overrides = profileForExe(profiles, foregroundExe)?.values;
  const out = {} as SpeedValues;
  for (const key of SPEED_VALUE_KEYS) out[key] = overrides?.[key] ?? global[key];
  return out;
}

/** The hit profile's stored overrides. Empty when no profile matches, so callers can still read live globals. */
export function speedOverrides(
  profiles: readonly ShortcutProfile[],
  foregroundExe: string,
): Partial<Record<SpeedValueKey, number>> {
  return profileForExe(profiles, foregroundExe)?.values ?? {};
}

/** Editor preview. `shortcuts === null` is the global table. */
export function previewShortcuts(
  global: GlobalShortcuts,
  shortcuts: Partial<Record<ShortcutSlot, string>> | null,
): ResolveResult {
  if (!shortcuts) return resolveShortcuts(global, [], "");
  return resolveShortcuts(global, [{ id: "_", name: "", processes: ["*"], shortcuts }], "*");
}

function conflictingSlots(shortcuts: GlobalShortcuts): ShortcutSlot[] {
  const byChord = new Map<string, ShortcutSlot[]>();
  for (const slot of SHORTCUT_SLOTS) {
    const chord = shortcuts[slot];
    if (!chord) continue;
    const list = byChord.get(chord) ?? [];
    list.push(slot);
    byChord.set(chord, list);
  }
  const out: ShortcutSlot[] = [];
  for (const slots of byChord.values()) {
    if (slots.length > 1) out.push(...slots);
  }
  return out;
}

export interface RegEntry {
  shortcut: string;
  slot: ShortcutSlot;
  hold: boolean;
  conflict: boolean;
}

/** One entry per chord. A conflict chord stays registered and does not change speed. */
export function registrationEntries(resolved: ResolveResult): RegEntry[] {
  const conflict = new Set(resolved.conflicts);
  const seen = new Set<string>();
  const out: RegEntry[] = [];
  for (const slot of SHORTCUT_SLOTS) {
    const shortcut = resolved.shortcuts[slot];
    if (!shortcut || seen.has(shortcut)) continue;
    seen.add(shortcut);
    const isConflict = conflict.has(slot);
    out.push({
      shortcut,
      slot,
      hold: slot === "holdShortcut" && !isConflict,
      conflict: isConflict,
    });
  }
  return out;
}

export function registrationSignature(entries: readonly RegEntry[]): string {
  return entries
    .map(entry => `${entry.shortcut}\0${entry.slot}\0${entry.conflict ? "c" : entry.hold ? "h" : "p"}`)
    .sort()
    .join("\n");
}

export function diffRegistration(current: readonly RegEntry[], next: readonly RegEntry[]): {
  unchanged: boolean;
  remove: string[];
  add: RegEntry[];
} {
  if (registrationSignature(current) === registrationSignature(next)) {
    return { unchanged: true, remove: [], add: [] };
  }
  const role = (entry: RegEntry) => `${entry.slot}\0${entry.conflict ? "c" : entry.hold ? "h" : "p"}`;
  const curBy = new Map(current.map(entry => [entry.shortcut, entry]));
  const nextBy = new Map(next.map(entry => [entry.shortcut, entry]));
  const remove: string[] = [];
  const add: RegEntry[] = [];
  for (const [shortcut, entry] of curBy) {
    const incoming = nextBy.get(shortcut);
    if (!incoming || role(incoming) !== role(entry)) remove.push(shortcut);
  }
  for (const [shortcut, entry] of nextBy) {
    const previous = curBy.get(shortcut);
    if (!previous || role(previous) !== role(entry)) add.push(entry);
  }
  return { unchanged: false, remove, add };
}
