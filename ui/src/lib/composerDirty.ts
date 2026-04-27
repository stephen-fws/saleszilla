/**
 * Tiny imperative singleton used to guard navigation away from a dirty
 * EmailComposer (in-app tab changes, potential switches).
 *
 * Why a module singleton rather than React state:
 *   - The composer lives inside one tab; the navigation triggers
 *     (TabBar click in DetailPanel, potential click in DashboardPage,
 *     queue-item click) live in components that don't share an obvious
 *     context. A flag we can read synchronously from any click handler
 *     keeps the guard logic local and small.
 *
 * Set true whenever the composer has unsaved changes. Cleared on save,
 * discard, send, or unmount.
 */

let _dirty = false;

export const composerDirty = {
  get: (): boolean => _dirty,
  set: (v: boolean): void => { _dirty = v; },
};

/**
 * Helper: if the composer is dirty, prompt the user before allowing
 * navigation. Returns true to proceed, false to cancel. If the user
 * proceeds, the composer is treated as discarded — the flag is cleared
 * so subsequent transitions don't keep prompting.
 */
export function confirmDiscardIfDirty(): boolean {
  if (!_dirty) return true;
  const ok = window.confirm(
    "You have unsaved changes in the email composer. Leave without saving? Your edits will be lost.",
  );
  if (ok) _dirty = false;
  return ok;
}
