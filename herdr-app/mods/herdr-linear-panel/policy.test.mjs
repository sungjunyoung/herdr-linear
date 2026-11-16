import { test } from "node:test";
import assert from "node:assert/strict";
import { INITIAL, groupIssues, linkOf, parseResult, step } from "./policy.js";

const issue = (identifier, type, priority, name = type) => ({
  identifier,
  title: identifier,
  url: `https://linear.app/x/issue/${identifier}`,
  branchName: `sungjunyoung/${identifier.toLowerCase()}-fix`,
  priority,
  state: { id: name, name, type },
  team: "HOMECO",
});

test("parseResult reads stdout whatever the exit code", () => {
  const ok = { status: "ok", issues: [issue("HOMECO-1", "started", 2)], states: { HOMECO: [] } };
  assert.deepEqual(parseResult({ code: 0, stdout: JSON.stringify(ok), stderr: "" }), ok);
  assert.deepEqual(parseResult({ code: 1, stdout: '{"status":"error","message":"login expired","needs_setup":true}', stderr: "x" }), {
    status: "error",
    message: "login expired",
    needsSetup: true,
  });
  assert.deepEqual(parseResult({ code: 1, stdout: '{"status":"error","message":"boom"}', stderr: "" }), { status: "error", message: "boom", needsSetup: false });
  assert.deepEqual(parseResult({ code: 2, stdout: "panic", stderr: "a\nusage: x\n" }), { status: "error", message: "usage: x", needsSetup: false });
  assert.deepEqual(parseResult({ code: 2, stdout: "", stderr: "" }), { status: "error", message: "herdr-linear exited with code 2.", needsSetup: false });
});

test("linkOf finds the space and tab working on an issue", () => {
  const i = issue("HOMECO-7", "started", 0);
  const tab = { id: "c1", name: "1", status: "working" };
  const allSpaces = [{ id: "s1", name: "backoffice", tabs: [tab] }];
  const exact = linkOf(i, [{ tab: "c1", branch: i.branchName }], allSpaces);
  assert.deepEqual(exact, { space: allSpaces[0], tab, branch: i.branchName });
  assert.equal(linkOf(i, [{ tab: "c1", branch: "homeco-7" }], allSpaces).branch, "homeco-7", "identifier in another branch");
  assert.equal(linkOf(i, [{ tab: "c1", branch: "homeco-70" }, { tab: "c1", branch: null }], allSpaces).branch, "homeco-70", "substring rule, as the reference");
  assert.equal(linkOf(i, [{ tab: "c1", branch: "main" }, { tab: "c1", branch: null }], allSpaces), null);
});

test("groupIssues: started first, then priority with none last", () => {
  const groups = groupIssues([
    issue("A", "backlog", 1, "Backlog"),
    issue("B", "unstarted", 0, "Todo"),
    issue("C", "started", 3, "In Progress"),
    issue("D", "unstarted", 1, "Todo"),
    issue("E", "triage", 2, "Triage"),
    issue("F", "started", 1, "In Progress"),
  ]);
  assert.deepEqual(
    groups.map((g) => [g.name, g.items.map((i) => i.identifier)]),
    [
      ["In Progress", ["F", "C"]],
      ["Todo", ["D", "B"]],
      ["Triage", ["E"]],
      ["Backlog", ["A"]],
    ],
  );
});

test("step never starts two loads, and a state change waits for its reload", () => {
  const loading = step(INITIAL, { type: "load" });
  assert.equal(loading.load.kind, "loading");
  assert.equal(step(loading, { type: "load" }), loading, "second load refused");
  const ok = step(loading, { type: "loaded", res: { status: "ok", issues: [issue("A", "unstarted", 0, "Todo")], states: {} }, now: 5 });
  assert.deepEqual([ok.load, ok.at, ok.issues.length], [{ kind: "ok" }, 5, 1]);
  const picked = step(ok, { type: "pick", id: "A" });
  assert.equal(step(picked, { type: "pick", id: "A" }).picking, null, "clicking the chip again closes it");
  const pending = step(picked, { type: "set", id: "A" });
  assert.deepEqual([pending.pending, pending.picking], ["A", null]);
  assert.equal(step(pending, { type: "load" }), pending, "timer load waits for the change");
  const done = step(pending, { type: "set-done", res: { status: "ok", identifier: "A", state: { id: "s2", name: "In Progress", type: "started" } } });
  assert.deepEqual([done.pending, done.issues[0].state.name], [null, "In Progress"]);
  const denied = step(pending, { type: "set-done", res: { status: "error", message: "no write scope", needsSetup: true } });
  assert.deepEqual([denied.pending, denied.load], [null, { kind: "error", message: "no write scope", needsSetup: true }]);
  assert.equal(denied.issues.length, 1, "the list stays under the error");
});
