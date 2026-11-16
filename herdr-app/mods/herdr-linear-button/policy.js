// Pure decisions for the Linear button. main.js owns every side effect.

// After a space switch the shipped tabs mod restores that space's own panel
// choice; for this long the global Linear state wins over what is shown.
export const SETTLE_MS = 1500;

// s: { open, space, until }. seen: { space, shown, now } where shown means the
// panel is visible with Linear active. Returns the next state and whether to
// show or hide Linear to match it.
export function reconcile(s, seen) {
  if (seen.space !== s.space) s = { ...s, space: seen.space, until: seen.now + SETTLE_MS };
  if (seen.shown === s.open) return { state: s, apply: null };
  if (seen.now < s.until) return { state: s, apply: s.open ? "show" : "hide" };
  return { state: { ...s, open: seen.shown }, apply: null };
}
