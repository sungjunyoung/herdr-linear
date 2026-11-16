// Your Linear issues, grouped by state, each linked to the space and tab
// working on it (by branch name). Data comes from `herdr-linear issues`.

import { View, div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { checking, exec, home, panes, run, spaces, theme } from "herdr";
import { INITIAL, groupIssues, linkOf, parseResult, step } from "./policy.js";

const PRIORITY = { 1: ["Urgent", "blocked"], 2: ["High", "working"] };
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
    if (checking()) return;
    cx.timer.every(5 * 60_000, (cx) => this.load(cx));
    // Keeps "<n>m ago" current between loads.
    cx.timer.every(60_000, (cx) => cx.notify());
    this.load(cx);
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
    const groups = groupIssues(s.issues);
    const stop = (_e, cx) => cx.stop_propagation();

    const link = (id, label, action) => div().id(id).text_size(11).text_color(t.dim).hover((st) => st.text_color(t.foreground))
      .on_mouse_down("left", stop).on_click((_e, cx) => { cx.stop_propagation(); action(cx); }).child(label);

    const button = (id, label, primary, action) => div().id(id).flex_none().px(9).py(3).rounded(5).text_size(11.5).font_medium().border_1()
      .border_color(primary ? t.solid : t.border).bg(primary ? t.solid : t.raised).text_color(primary ? t.solid_foreground : t.foreground)
      .hover((st) => st.opacity(0.85)).on_mouse_down("left", stop)
      .on_click((_e, cx) => { cx.stop_propagation(); action(cx); }).child(label);

    const dot = (status) => status === "working"
      ? div().size(9).rounded(5).border_2().border_color(t.working)
      : div().size(8).rounded(4).bg(status ? t[status] : t.dim);

    const chip = (i) => {
      const open = s.picking === i.identifier;
      return div().id(`state-${i.identifier}`).flex_none().px(7).py(2).rounded(5).text_size(11).border_1()
        .border_color(open ? t.input : t.border).bg(open ? t.selected : t.raised).text_color(t.muted)
        .hover((st) => st.text_color(t.foreground)).on_mouse_down("left", stop)
        .on_click((_e, cx) => { cx.stop_propagation(); this.dispatch({ type: "pick", id: i.identifier }); cx.notify(); })
        .child(s.pending === i.identifier ? "Updating…" : i.state.name);
    };

    const picker = (i) => h_flex().flex_wrap().gap(5).pt(2).children((s.states[i.team] ?? []).map((st) => {
      const current = st.id === i.state.id;
      return div().id(`set-${i.identifier}-${st.id}`).px(7).py(2).rounded(5).text_size(11).border_1()
        .border_color(current ? t.accent : t.border).bg(current ? t.selected : t.background)
        .text_color(current ? t.foreground : t.muted).hover((x) => x.bg(t.hover)).on_mouse_down("left", stop)
        .on_click((_e, cx) => { cx.stop_propagation(); if (!current) this.setState(i, st.id, cx); })
        .child(st.name);
    }));

    const row = (i) => {
      const l = linkOf(i, allPanes, allSpaces);
      const pri = PRIORITY[i.priority];
      const open = () => l ? (run("space.select", { id: l.space.id }), run("tab.select", { id: l.tab.id })) : exec("open", [i.url]);
      return v_flex().id(`issue-${i.identifier}`).w_full().px(14).py(8).gap(5).hover((st) => st.bg(t.hover)).on_click(() => open())
        .child(h_flex().gap(8).items_center()
          .child(div().flex_none().text_size(11).text_color(t.dim).child(i.identifier))
          .child(div().flex_1().min_w(0).truncate().font_medium().child(i.title))
          .when(Boolean(pri), (el) => el.child(div().flex_none().text_size(11).text_color(t[pri[1]]).child(pri[0])))
          .child(chip(i))
          .when(Boolean(l), (el) => el.child(button(`open-${i.identifier}`, "Linear", false, () => exec("open", [i.url])))))
        .when(Boolean(l), (el) => el.child(h_flex().gap(8).items_center().text_size(11.5).text_color(t.muted)
          .child(dot(l.tab.status))
          .child(div().flex_1().min_w(0).truncate().child(`${l.space.name} › ${l.tab.name}`))))
        .when(s.picking === i.identifier, (el) => el.child(picker(i)));
    };

    const section = (g) => [
      h_flex().px(14).pt(10).pb(4).gap(8).items_center().text_size(11.5)
        .child(div().font_semibold().text_color(t.foreground).child(g.name))
        .child(div().text_color(t.dim).child(String(g.items.length))),
      ...g.items.map(row),
    ];

    const sync = s.load.kind === "loading" ? "loading…" : s.at ? ago(s.at) : "";
    const error = s.load.kind === "error" ? s.load : null;
    const empty = s.load.kind === "loading" ? "Loading your issues…" : s.load.kind === "ok" ? "No open issues assigned to you" : "Not loaded yet";
    const setup = () => run("herdr-linear.setup");

    return v_flex().id("herdr-linear-panel").size_full().min_h(0).rounded(10).overflow_hidden().bg(t.background).border_1().border_color(t.border)
      .text_color(t.foreground).text_size(13)
      .child(h_flex().h(42).flex_none().px(14).gap(8).items_center().border_b(1).border_color(t.border)
        .child(div().font_semibold().child("My issues"))
        .child(div().text_size(11).text_color(t.dim).child(s.issues.length ? String(s.issues.length) : ""))
        .child(div().flex_1())
        .child(link("linear-refresh", sync ? `${sync} · refresh` : "refresh", (cx) => this.load(cx)))
        .child(div().id("linear-more").px(6).rounded(5).text_color(this.menu ? t.foreground : t.dim).when(this.menu, (el) => el.bg(t.selected))
          .hover((st) => st.bg(t.hover)).on_mouse_down("left", stop)
          .on_click((_e, cx) => { cx.stop_propagation(); this.menu = !this.menu; cx.notify(); }).child("⋯")))
      .when(this.menu, (el) => el.child(h_flex().flex_none().flex_wrap().px(14).py(6).gap(12).bg(t.raised).border_b(1).border_color(t.border)
        .children(MENU.map(([label, command]) => link(`menu-${command}`, label, (cx) => { this.menu = false; run(command); cx.notify(); })))))
      .when(Boolean(error), (el) => el.child(h_flex().flex_none().px(14).py(8).gap(8).items_center().bg(t.raised).border_b(1).border_color(t.border)
        .child(div().flex_1().min_w(0).text_size(12).text_color(t.blocked).child(`Linear: ${error.message}`))
        .when(error.needsSetup, (el) => el.child(button("linear-setup", "Set up", true, setup)))))
      .child(v_flex().id("herdr-linear-list").flex_1().min_h(0).overflow_y_scrollbar()
        .children(groups.flatMap(section))
        .when(groups.length === 0, (el) => el.child(div().p(24).text_center().text_color(t.dim).child(empty))));
  }
}
