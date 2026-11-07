import { Store } from "@tauri-apps/plugin-store";

let _store: Store | null = null;

async function getStore() {
  if (!_store) _store = await Store.load("process.json");
  return _store;
}

/** Get the list of process names marked for acceleration. */
export async function getAcceleratedNames(): Promise<string[]> {
  const store = await getStore();
  const names = await store.get<string[]>("names");
  return names ?? [];
}

/** Add a process name to the acceleration list. */
export async function addAcceleratedName(name: string) {
  const store = await getStore();
  const names = await getAcceleratedNames();
  if (!names.includes(name)) {
    names.push(name);
    await store.set("names", names);
    await store.save();
  }
}

/** Remove a process name from the acceleration list. */
export async function removeAcceleratedName(name: string) {
  const store = await getStore();
  const names = await getAcceleratedNames();
  const idx = names.indexOf(name);
  if (idx >= 0) {
    names.splice(idx, 1);
    await store.set("names", names);
    await store.save();
  }
}

/** Check if a process name is in the acceleration list. */
export async function isAcceleratedName(name: string): Promise<boolean> {
  const names = await getAcceleratedNames();
  return names.includes(name);
}

/** Replace the entire list. */
export async function setAcceleratedNames(names: string[]) {
  const store = await getStore();
  await store.set("names", names);
  await store.save();
}
