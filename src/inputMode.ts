/**
 * Where the shortcut action runs.
 *
 * Stage 3 moves the action into Rust; the webview then only shows the result.
 * The flag lives in its own module so both the shortcut hook and the speed
 * store can read it without importing each other.
 */

let dispatchInRust = false;

/** The user changed the speed by hand in this session. */
let userTouchedSpeed = false;

export function setDispatchInRust(on: boolean): void {
  dispatchInRust = on;
}

export function dispatchInRustEnabled(): boolean {
  return dispatchInRust;
}

/** A manual change ends the automatic speed for the rest of the session. */
export function markUserSpeedChange(): void {
  userTouchedSpeed = true;
}

export function userTouchedSpeedFlag(): boolean {
  return userTouchedSpeed;
}
