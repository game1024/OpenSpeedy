// Processes that belong to OpenSpeedy itself. They must never show up in a
// process picker: accelerating or binding to our own bridge helpers is never
// what the user means, and they are an implementation detail.
const HIDDEN_PROCESS_NAMES = new Set(["bridge32.exe", "bridge64.exe"]);

export function isHiddenProcess(name: string): boolean {
  return HIDDEN_PROCESS_NAMES.has(name.toLowerCase());
}

/** Filter a process list, matching on the exe base name. */
export function withoutHiddenProcesses<T extends { name: string }>(list: T[]): T[] {
  return list.filter(proc => !isHiddenProcess(proc.name));
}
