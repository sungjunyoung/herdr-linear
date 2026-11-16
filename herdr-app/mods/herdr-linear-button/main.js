// The tab bar's top-right Linear button: shows or hides the Linear panel.

import { View, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { layout, run, setShared, shared, theme } from "herdr";

const ID = "linear";

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

export default class LinearButton extends View {
  init() {
    // The shipped tabs mod restores the panel per space only for ids in this list,
    // so without it switching spaces would close the Linear panel.
    const panels = shared("workspace.panels") ?? ["files", "changes"];
    if (!panels.includes(ID)) setShared("workspace.panels", [...panels, ID]);
  }

  render() {
    const t = theme();
    const root = layout(), panel = find(root, "panel"), body = find(root, "panel-body");
    const on = Boolean(panel && !panel.hidden && body?.active === ID);
    return h_flex().size_full().pr(10).items_center().justify_end().bg(t.chrome).border_b(1).border_color(t.border)
      .child(h_flex().id("linear-button").h(26).px(8).gap(5).flex_none().items_center().rounded(6)
        .text_size(12).bg(on ? t.selected : t.chrome).text_color(on ? t.foreground : t.muted)
        .hover((s) => s.bg(t.hover)).on_mouse_down("left", (_e, cx) => cx.stop_propagation())
        .on_click(() => {
          if (on) run("layout.hide", { id: "panel" });
          else { run("layout.select", { stack: "panel-body", child: ID }); run("layout.show", { id: "panel" }); }
        })
        .child(svg("mods/herdr-linear-button/linear.svg").size(14)).child("Linear"));
  }
}
