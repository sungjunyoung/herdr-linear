// The tab bar's top-right Linear button: shows or hides the Linear panel, and
// keeps it open or closed across spaces.

import { View, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { layout, run, setShared, shared, spaces, theme } from "herdr";
import { reconcile } from "./policy.js";

const ID = "linear";
const OPEN = "herdr-linear.open";

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

function shown() {
  const root = layout(), panel = find(root, "panel"), body = find(root, "panel-body");
  return Boolean(panel && !panel.hidden && body?.active === ID);
}

function show(open) {
  if (open) { run("layout.select", { stack: "panel-body", child: ID }); run("layout.show", { id: "panel" }); }
  else if (shown()) run("layout.hide", { id: "panel" });
}

export default class LinearButton extends View {
  init(_props, cx) {
    // The shipped tabs mod restores the panel per space only for ids in this list,
    // so without it switching spaces would close the Linear panel.
    const panels = shared("workspace.panels") ?? ["files", "changes"];
    if (!panels.includes(ID)) setShared("workspace.panels", [...panels, ID]);
    this.s = { open: shared(OPEN) ?? shown(), space: undefined, until: 0 };
    // render must stay free of side effects, so a cheap scan corrects the
    // shipped tabs mod's per-space restore right after a switch.
    cx.timer.every(200, (cx) => this.tick(cx));
  }

  tick(cx) {
    const space = spaces().find((s) => s.active)?.id;
    const { state, apply } = reconcile(this.s, { space, shown: shown(), now: Date.now() });
    if (state.open !== this.s.open) setShared(OPEN, state.open);
    this.s = state;
    if (apply) { show(apply === "show"); cx.notify(); }
  }

  toggle() {
    this.s = { ...this.s, open: !shown() };
    setShared(OPEN, this.s.open);
    show(this.s.open);
  }

  render() {
    const t = theme();
    const on = shown();
    return h_flex().size_full().pr(10).items_center().justify_end().bg(t.chrome).border_b(1).border_color(t.border)
      .child(h_flex().id("linear-button").h(26).px(8).gap(5).flex_none().items_center().rounded(6)
        .text_size(12).bg(on ? t.selected : t.chrome).text_color(on ? t.foreground : t.muted)
        .hover((s) => s.bg(t.hover)).on_mouse_down("left", (_e, cx) => cx.stop_propagation())
        .on_click(() => this.toggle())
        .child(svg("mods/herdr-linear-button/linear.svg").size(14)).child("Linear"));
  }
}
