import { test } from "node:test";
import assert from "node:assert/strict";
import { INITIAL, groupIssues, linkOf, parseResult, shortDate, statusIcon, step, tint } from "./policy.js";

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
  assert.equal(linkOf(i, [{ tab: "c1", branch: "user/homeco-7-login" }], allSpaces).branch, "user/homeco-7-login", "identifier as a token");
  assert.equal(linkOf(i, [{ tab: "c1", branch: "homeco-70" }, { tab: "c1", branch: null }], allSpaces), null, "a longer number is another issue");
  assert.equal(linkOf(i, [{ tab: "c1", branch: "homeco-7abc" }], allSpaces), null, "letters after the number are another ref");
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

test("statusIcon follows Linear's glyphs", () => {
  const states = [
    { id: "rev", type: "started", position: 1002 },
    { id: "prog", type: "started", position: 2 },
  ];
  const icon = (state) => statusIcon(state, states).split("/").pop();
  assert.equal(icon({ id: "prog", type: "started" }), "status-started.svg");
  assert.equal(icon({ id: "rev", type: "started" }), "status-review.svg");
  assert.equal(icon({ type: "backlog" }), "status-backlog.svg");
  assert.equal(icon({ type: "unstarted" }), "status-unstarted.svg");
  assert.equal(icon({ type: "triage" }), "status-unstarted.svg");
  assert.equal(icon({ type: "duplicate" }), "status-canceled.svg");
  assert.equal(icon({ type: "completed" }), "status-completed.svg");
});

test("shortDate", () => {
  assert.equal(shortDate("2026-11-16T03:00:00.000Z").startsWith("Nov "), true);
  assert.equal(shortDate("nope"), "");
});

test("groupIssues puts the later started state first", () => {
  const prog = { id: "prog", name: "In Progress", type: "started" }, rev = { id: "rev", name: "In Review", type: "started" };
  const states = { HOMECO: [{ ...prog, position: 2 }, { ...rev, position: 1002 }] };
  const groups = groupIssues([{ identifier: "A", priority: 0, state: prog }, { identifier: "B", priority: 0, state: rev }], states);
  assert.deepEqual(groups.map((g) => g.name), ["In Review", "In Progress"]);
});

test("tint adds alpha to #rrggbb only", () => {
  assert.equal(tint("#f2c94c", 0.08), "#f2c94c14");
  assert.equal(tint("#F2C94C", 1), "#F2C94Cff");
  assert.equal(tint("#abc", 0.5), "#abc");
});
