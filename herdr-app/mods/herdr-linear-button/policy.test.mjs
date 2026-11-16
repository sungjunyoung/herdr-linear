import { test } from "node:test";
import assert from "node:assert/strict";
import { SETTLE_MS, reconcile } from "./policy.js";

test("a space switch shows the global Linear state, not the space's own", () => {
  const s = { open: true, space: "a", until: 0 };
  const r = reconcile(s, { space: "b", shown: false, now: 1000 });
  assert.equal(r.apply, "show");
  assert.equal(r.state.open, true);
  assert.equal(reconcile({ ...s, open: false }, { space: "b", shown: true, now: 1000 }).apply, "hide");
});

test("outside the settle window the user's toggle becomes the global state", () => {
  const s = { open: true, space: "a", until: 1000 + SETTLE_MS };
  const r = reconcile(s, { space: "a", shown: false, now: 1000 + SETTLE_MS });
  assert.equal(r.apply, null);
  assert.equal(r.state.open, false);
});

test("nothing to do when shown matches the global state", () => {
  const s = { open: false, space: "a", until: 0 };
  assert.deepEqual(reconcile(s, { space: "a", shown: false, now: 5 }), { state: s, apply: null });
});
