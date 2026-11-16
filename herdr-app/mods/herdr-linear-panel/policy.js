// Pure state for the Linear panel. main.js owns every side effect.

export const INITIAL = { load: { kind: "idle" }, issues: [], states: {}, at: null, picking: null, pending: null };

// One transition per event. A refused event returns the same object, so the
// caller starts no work: never two loads at once, and no load while a state
// change is in flight (its reload follows it).
export function step(s, e) {
  switch (e.type) {
    case "load":
      return s.load.kind === "loading" || s.pending ? s : { ...s, load: { kind: "loading" } };
    case "loaded":
      return e.res.status === "ok"
        ? { ...s, load: { kind: "ok" }, issues: e.res.issues ?? [], states: e.res.states ?? {}, at: e.now }
        : { ...s, load: failed(e.res) };
    case "pick":
      return { ...s, picking: s.picking === e.id ? null : e.id };
    case "set":
      return s.load.kind === "loading" || s.pending ? s : { ...s, pending: e.id, picking: null };
    case "set-done":
      if (e.res.status !== "ok") return { ...s, pending: null, load: failed(e.res) };
      return { ...s, pending: null, issues: s.issues.map((i) => (i.identifier === e.res.identifier ? { ...i, state: e.res.state } : i)) };
    default:
      return s;
  }
}

const failed = (res) => ({ kind: "error", message: res.message || "Linear request failed.", needsSetup: res.needsSetup === true });

// `herdr-linear` prints one JSON object and exits 1 on error, so stdout is
// read whatever the exit code.
export function parseResult({ code, stdout, stderr }) {
  try {
    const res = JSON.parse(stdout);
    if (res?.status === "ok") return res;
    if (res?.status === "error") return { status: "error", message: res.message, needsSetup: res.needs_setup === true };
  } catch {}
  const why = (stderr || stdout || "").trim().split("\n").pop();
  return { status: "error", message: why || `herdr-linear exited with code ${code}.`, needsSetup: false };
}

// Linear's own branch name, or any branch that carries the identifier (homeco-412-…).
export function linkOf(issue, allPanes, allSpaces) {
  const id = issue.identifier.toLowerCase();
  const pane = allPanes.find((p) => p.branch && (p.branch === issue.branchName || p.branch.toLowerCase().includes(id)));
  if (!pane) return null;
  const space = allSpaces.find((s) => s.tabs.some((t) => t.id === pane.tab));
  const tab = space?.tabs.find((t) => t.id === pane.tab);
  return space && tab ? { space, tab, branch: pane.branch } : null;
}

const TYPE_RANK = { started: 0, unstarted: 1, triage: 2, backlog: 3 };

// Work in progress first, then by priority (0, no priority, last); one group
// per state name, in that order.
export function groupIssues(issues) {
  const sorted = [...issues].sort(
    (a, b) => (TYPE_RANK[a.state.type] ?? 9) - (TYPE_RANK[b.state.type] ?? 9) || (a.priority || 9) - (b.priority || 9),
  );
  const groups = [];
  for (const i of sorted) {
    const g = groups.find((x) => x.name === i.state.name);
    if (g) g.items.push(i);
    else groups.push({ name: i.state.name, type: i.state.type, items: [i] });
  }
  return groups;
}
