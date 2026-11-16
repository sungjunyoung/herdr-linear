// Your Linear issues, grouped by state, each linked to the space and tab
// working on it (by branch name). Data comes from `herdr-linear issues`.

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { checking, exec, home, panes, run, spaces, theme } from "herdr";
import { INITIAL, groupIssues, linkOf, parseResult, shortDate, statusIcon, step } from "./policy.js";

// Linear's priority glyph: how many of the three bars are lit.
const BARS = { 2: 3, 3: 2, 4: 1 };
const URGENT = "#f2994a";
// The title mod's commands; it sits in the same layout's footer.
const MENU = [
  ["Refresh title", "herdr-linear.refresh"],
  ["Refresh all", "herdr-linear.refresh-all"],
  ["Set up", "herdr-linear.setup"],
  ["Log out", "herdr-linear.logout"],
];

function ago(ms) {
  const m = Math.floor((Date.now() - ms) / 60_000);
  return m < 1 ? "just now" : m < 60 ? `${m}m ago` : `${Math.floor(m / 60)}h ago`;
}

export default class LinearPanel extends View {
  init(_props, cx) {
    this.bin = `${home()}/.local/bin/herdr-linear`;
    this.s = INITIAL;
    this.menu = false;
    try { this.folded = new Set(JSON.parse(localStorage.getItem("folded") ?? "[]")); } catch { this.folded = new Set(); }
    if (checking()) return;
    cx.timer.every(5 * 60_000, (cx) => this.load(cx));
    // Keeps "<n>m ago" current between loads.
    cx.timer.every(60_000, (cx) => cx.notify());
    this.load(cx);
  }

  fold(name) {
    if (this.folded.has(name)) this.folded.delete(name); else this.folded.add(name);
    try { localStorage.setItem("folded", JSON.stringify([...this.folded])); } catch {}
  }

  dispatch(event) {
    const next = step(this.s, event);
    if (next === this.s) return false;
    this.s = next;
    return true;
  }

  async call(args) {
    try {
      return parseResult(await exec(this.bin, args, { timeout: 30000 }));
    } catch (e) {
      return { status: "error", message: `Cannot run ${this.bin} (${e}). Run make install-app.`, needsSetup: false };
    }
  }

  load(cx) {
    if (!this.dispatch({ type: "load" })) return;
    cx.notify();
    cx.spawn(async (cx) => {
      this.dispatch({ type: "loaded", res: await this.call(["issues"]), now: Date.now() });
      cx.notify();
    });
  }

  setState(issue, stateId, cx) {
    if (!this.dispatch({ type: "set", id: issue.identifier })) return;
    cx.notify();
    cx.spawn(async (cx) => {
      const res = await this.call(["set-state", issue.identifier, stateId]);
      this.dispatch({ type: "set-done", res });
      cx.notify();
      if (res.status === "ok") this.load(cx);
    });
  }

  render() {
    const t = theme();
    const s = this.s;
    const allPanes = panes(), allSpaces = spaces();
    const groups = groupIssues(s.issues, s.states);
    const stop = (_e, cx) => cx.stop_propagation();
    const press = (el, action) => el.on_mouse_down("left", stop).on_click((_e, cx) => { cx.stop_propagation(); action(cx); });

    const link = (id, label, action) => press(div().id(id).text_size(11).text_color(t.dim).hover((st) => st.text_color(t.foreground)), action).child(label);

    const button = (id, label, action) => press(div().id(id).flex_none().px(9).py(3).rounded(5).text_size(11.5).font_medium()
      .bg(t.solid).text_color(t.solid_foreground).hover((st) => st.opacity(0.85)), action).child(label);

    const status = (state, team) => svg(statusIcon(state, s.states[team])).size(14).flex_none().text_color(state.color || t.muted);

    const priority = (p) => {
      if (p === 1) return div().size(14).flex_none().rounded(3).bg(URGENT).flex().items_center().justify_center()
        .text_size(10).font_bold().text_color("#ffffff").child("!");
      const lit = BARS[p];
      if (!lit) return div().w(14).flex_none().text_size(11).text_color(t.dim).child("···");
      return h_flex().w(14).h(12).flex_none().gap(1).items_end()
        .children([6, 9, 12].map((h, n) => div().w(3).h(h).rounded(1).bg(n < lit ? t.muted : t.border)));
    };

    const agent = (st) => st === "working"
      ? div().size(8).flex_none().rounded(4).border_2().border_color(t.working)
      : div().size(7).flex_none().rounded(4).bg(st ? t[st] : t.dim);

    const picker = (i) => v_flex().mx(12).mb(6).py(4).rounded(8).border_1().border_color(t.border).bg(t.raised)
      .children((s.states[i.team] ?? []).map((st) => {
        const current = st.id === i.state.id;
        return press(h_flex().id(`set-${i.identifier}-${st.id}`).h(28).px(10).gap(8).items_center().text_size(12.5)
          .hover((x) => x.bg(t.hover)), (cx) => { if (!current) this.setState(i, st.id, cx); })
          .child(status(st, i.team))
          .child(div().flex_1().child(st.name))
          .when(current, (el) => el.child(div().text_size(11).text_color(t.dim).child("✓")));
      }));

    const row = (i) => {
      const l = linkOf(i, allPanes, allSpaces);
      const go = () => l ? (run("space.select", { id: l.space.id }), run("tab.select", { id: l.tab.id })) : exec("open", [i.url]);
      const pending = s.pending === i.identifier;
      return [
        h_flex().id(`issue-${i.identifier}`).h(36).px(12).gap(9).items_center().hover((st) => st.bg(t.hover)).on_click(() => go())
          .child(priority(i.priority))
          .child(div().flex_none().min_w(86).text_size(12).text_color(t.dim).child(i.identifier))
          .child(press(div().id(`state-${i.identifier}`).flex_none().p(2).rounded(4).hover((st) => st.bg(t.selected)),
            (cx) => { this.dispatch({ type: "pick", id: i.identifier }); cx.notify(); })
            .when(pending, (el) => el.opacity(0.4)).child(status(i.state, i.team)))
          .child(div().flex_1().min_w(0).truncate().text_size(13).child(i.title))
          .when(Boolean(i.project), (el) => el.child(h_flex().flex_none().max_w(120).h(22).px(8).gap(5).items_center().rounded(11)
            .border_1().border_color(t.border).text_size(11.5).text_color(t.muted)
            .child(svg("mods/herdr-linear-panel/project.svg").size(12).flex_none())
            .child(div().min_w(0).truncate().child(i.project))))
          .when(Boolean(l), (el) => el.child(agent(l.tab.status)))
          .when(Boolean(l), (el) => el.child(link(`open-${i.identifier}`, "↗", () => exec("open", [i.url]))))
          .child(div().flex_none().w(44).text_right().text_size(11.5).text_color(t.dim).child(shortDate(i.updatedAt))),
        ...(s.picking === i.identifier ? [picker(i)] : []),
      ];
    };

    const section = (g) => {
      const folded = this.folded.has(g.name);
      return [
        h_flex().id(`group-${g.name}`).h(34).mx(6).mt(4).px(8).gap(9).items_center().rounded(6).bg(t.raised).hover((st) => st.bg(t.hover))
          .on_click((_e, cx) => { this.fold(g.name); cx.notify(); })
          .child(div().w(10).text_size(9).text_color(t.dim).child(folded ? "▶" : "▼"))
          .child(status(g.state, g.team))
          .child(div().text_size(13).font_medium().child(g.name))
          .child(div().text_size(12.5).text_color(t.dim).child(String(g.items.length))),
        ...(folded ? [] : g.items.flatMap(row)),
      ];
    };

    const sync = s.load.kind === "loading" ? "loading…" : s.at ? ago(s.at) : "";
    const error = s.load.kind === "error" ? s.load : null;
    const empty = s.load.kind === "loading" ? "Loading your issues…" : s.load.kind === "ok" ? "No open issues assigned to you" : "Not loaded yet";
    const setup = () => run("herdr-linear.setup");

    return v_flex().id("herdr-linear-panel").size_full().min_h(0).rounded(10).overflow_hidden().bg(t.background).border_1().border_color(t.border)
      .text_color(t.foreground).text_size(13)
      .child(h_flex().h(42).flex_none().px(14).gap(8).items_center().border_b(1).border_color(t.border)
        .child(div().font_semibold().child("My issues"))
        .child(div().text_size(12).text_color(t.dim).child(s.issues.length ? String(s.issues.length) : ""))
        .child(div().flex_1())
        .child(link("linear-refresh", sync ? `${sync} · refresh` : "refresh", (cx) => this.load(cx)))
        .child(press(div().id("linear-more").px(6).rounded(5).text_color(this.menu ? t.foreground : t.dim).when(this.menu, (el) => el.bg(t.selected))
          .hover((st) => st.bg(t.hover)), (cx) => { this.menu = !this.menu; cx.notify(); }).child("⋯")))
      .when(this.menu, (el) => el.child(h_flex().flex_none().flex_wrap().px(14).py(6).gap(12).bg(t.raised).border_b(1).border_color(t.border)
        .children(MENU.map(([label, command]) => link(`menu-${command}`, label, (cx) => { this.menu = false; run(command); cx.notify(); })))))
      .when(Boolean(error), (el) => el.child(h_flex().flex_none().px(14).py(8).gap(8).items_center().bg(t.raised).border_b(1).border_color(t.border)
        .child(div().flex_1().min_w(0).text_size(12).text_color(t.blocked).child(`Linear: ${error.message}`))
        .when(error.needsSetup, (el) => el.child(button("linear-setup", "Set up", setup)))))
      .child(v_flex().id("herdr-linear-list").flex_1().min_h(0).pb(6).overflow_y_scrollbar()
        .children(groups.flatMap(section))
        .when(groups.length === 0, (el) => el.child(div().p(24).text_center().text_color(t.dim).child(empty))));
  }
}
