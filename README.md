# herdr linear

A [herdr](https://herdr.dev) plugin that renames worktree workspaces after the
Linear issue in their branch name.

```text
branch homeco-2290                        →  workspace "HOMECO-2290 testflight, google play console 빌드제출"
branch sungjunyoung/homeco-2291-login     →  workspace "HOMECO-2291 홈코데스크 로그인 페이지 개선"
```

- Runs automatically when herdr creates a worktree or reopens a closed one.
- Keeps labels you chose yourself (e.g. `herdr worktree create --label ...`).
  The manual actions overwrite them.
- Branches without a configured team key (`develop`, `main`) are ignored.
- On failure (issue not found, auth expired) the label is left alone and a
  herdr notification explains why.

## Requirements

- herdr 0.9.3 or newer, macOS or Linux (including WSL2).
- [Nix](https://nixos.org/download) with flakes. The plugin build runs
  `nix develop --command make build`, so no other toolchain is needed.
- A Linear workspace where you can either create an OAuth application (admins
  only) or a personal API key (admins, or members when allowed by an admin).

## Install

```sh
herdr plugin install sungjunyoung/herdr-linear
```

Then open the setup popup. herdr has no menu for plugin actions, so run this
from any pane inside herdr (or bind a key, see [Actions](#actions)):

```sh
herdr plugin action invoke sungjunyoung.linear.setup
```

The action opens the popup pane directly, which you can also do yourself:

```sh
herdr plugin pane open --plugin sungjunyoung.linear --entrypoint setup --focus
```

A herdr TUI client must be attached. Without one the command still answers
`ok`, but no popup appears.

The popup asks for:

1. **Team keys**: the issue prefix of your Linear teams, e.g. `HOMECO` for
   `HOMECO-2290`. Comma separated for several teams.
2. **Authentication**: OAuth (recommended) or a personal API key.

Setup verifies the credentials and writes `config.toml` to the plugin config
directory (`herdr plugin config-dir sungjunyoung.linear`).

### OAuth

Create an OAuth application once in Linear: *Settings → Administration → API →
OAuth applications → New*.

| Field | Value |
| --- | --- |
| Name | anything without the word "Linear", e.g. `herdr-retitle` |
| Callback URLs | `http://localhost:53682/callback` |

Only the **client ID** is needed; the plugin uses PKCE, so never enter the
client secret. During setup a browser window opens for authorization. Tokens
are stored in the plugin state directory with `0600` permissions and refreshed
automatically. To use another port, register
`http://localhost:<port>/callback` and enter that port in setup.

On WSL2 the authorization page opens in the Windows browser and the callback
reaches the plugin through WSL's localhost forwarding.

### Personal API key

Create a key in *Settings → Security & access → Personal API keys* (read
access is enough for titles; changing state from the Linear panel needs
write access) and choose "Personal API key" in setup.

## Actions

| Action | Effect |
| --- | --- |
| `sungjunyoung.linear.refresh` | Retitle the current workspace, overwriting its label |
| `sungjunyoung.linear.refresh-all` | Retitle every open worktree workspace |
| `sungjunyoung.linear.setup` | Open the setup / login popup |
| `sungjunyoung.linear.logout` | Revoke and delete the OAuth token |

herdr runs plugin actions only through keybindings or
`herdr plugin action invoke <action>`. Bind them in
`~/.config/herdr/config.toml`, then reload with `prefix+shift+r`:

```toml
[[keys.command]]
key = "prefix+i"
type = "plugin_action"
command = "sungjunyoung.linear.refresh"
description = "refresh workspace title"
```

## Configuration

`config.toml` is written by setup and can be edited by hand:

```toml
team_keys = ["HOMECO"]
title_format = "{identifier} {title}"   # placeholders: {identifier}, {title}

[auth]
method = "oauth"                        # or "api_key" with api_key = "lin_api_..."
oauth_client_id = "..."
oauth_redirect_port = 53682
```

herdr's sidebar stops growing at `ui.sidebar_max_width` (36 columns by
default) and truncates longer labels with `…`. Raise it if you want to see
more of the title.

With saved SSH machines, the plugin runs on the machine whose herdr server
emits the event, so install and set it up on that machine.

## Herdr desktop app

The same titles work in the Herdr desktop app (`herdr-app`) through a mod in
`herdr-app/mods/herdr-linear`. From a checkout of this repository:

```sh
nix develop --command make install-app
```

This installs the binary to `~/.local/bin/herdr-linear`, copies the mods into
`~/.config/herdr-app/mods/`, and installs the `herdr-linear` layout: Herdr's
`main` layout with the title in the footer and a Linear button at the top
right. Rerun it after changing a mod. Switch to the layout once with
`ctrl-shift-l` or:

```sh
herdr-app do layout.switch '{"name":"herdr-linear"}'
```

When an older `linear` layout clone still shows the `linear-title` mod,
`make install-app` switches to `herdr-linear` for you and moves the old file
aside as `linear.json.bak-<time>`.

`herdr-linear` is a clone of `main` and no longer gets Herdr's updates to
`main`. To stay on `main`, open the title mod as a small kept window instead,
which floats over the layout: `herdr-app do mod.open --name herdr-linear`.
The Linear panel needs the `herdr-linear` layout.

The footer shows the issue of the shown space and follows it when you switch
spaces. Use the footer or the kept window, not both. When the last result is
a missing config or login, the footer shows that instead: click it to run
setup.

The app shares `config.toml` and the OAuth token with the TUI plugin, so one
setup serves both. Without the TUI plugin, run setup once from a terminal:

```sh
herdr-linear setup
```

The mod renames a space when its branch has an issue reference and the space
has no name yet, or still has the name the mod gave it. A branch switch
retitles it once herdr-app notices the new branch, which can take half a
minute. A name you set yourself is kept until you refresh.

Commands, bound in `~/.config/herdr-app/keys.json`:

```json
{ "global": { "cmd-alt-l": "herdr-linear.refresh" } }
```

| Command | Effect |
| --- | --- |
| `herdr-linear.refresh` | Retitle the focused space, overwriting its name |
| `herdr-linear.refresh-all` | Retitle every space, retrying failures |
| `herdr-linear.setup` | Open setup in a new tab |
| `herdr-linear.logout` | Revoke and delete the OAuth token |

Limits:

- Spaces on other machines (`hc machine add`) are titled too, but the
  lookup runs on the computer with the app: install and set up the binary
  there. The other machine needs nothing.
- The mod runs only while the shown layout holds it (the `herdr-linear`
  footer or the kept window).

### Linear panel

The Linear button at the right end of the tab bar opens a panel beside the
work with your open Linear issues, grouped by state (in progress first, then
by priority). It loads the first time you open it, then every 5 minutes
and when you click refresh.

- Clicking an issue goes to the space and tab whose branch carries it. Under
  such an issue you see that space and tab with its agent status.
- An issue no space works on has **Start**: it opens Herdr's New worktree
  dialog for the issue's branch, in the repo of the shown space.
- The state chip on each issue lists its team's states. Pick one to move the
  issue there. This needs write access: with OAuth, run setup again once to
  grant the `write` scope; a personal API key needs write access.
- `⋯` in the panel header runs the title commands: Refresh title, Refresh all,
  Set up and Log out.
- When Linear needs a login or a new grant, the panel shows the error with a
  Set up button.

The panel shows in its space the way Files and Changes do: Herdr remembers per
space whether it was open.

## Upgrading from herdr-linear-title

This project was renamed from `herdr-linear-title` (plugin id
`sungjunyoung.linear-title`). The existing login keeps working:

- On its first run, `herdr-linear` copies `config.toml` and the OAuth token
  from the `sungjunyoung.linear-title` config and state directories when its
  own are empty.
- Uninstall the old TUI plugin so both do not retitle the same workspaces:
  `herdr plugin uninstall sungjunyoung.linear-title`.
- Rebind `linear-title.*` commands in `~/.config/herdr-app/keys.json` to
  `herdr-linear.*`, and plugin actions in `~/.config/herdr/config.toml` to
  `sungjunyoung.linear.*`.
- `make install-app` removes the old `linear-title` app mod and sets aside an
  old `linear` layout clone that shows it (see [Herdr desktop app](#herdr-desktop-app)).

## Troubleshooting

```sh
herdr plugin log list --plugin sungjunyoung.linear
```

Every run logs what it did ("renamed to ...", "kept user label ...") or why it
failed.

## Development

```sh
direnv allow          # or: nix develop
make test lint
make link             # builds ./bin and links this checkout into herdr
```

`herdr plugin link` does not run `[[build]]`; run `make build` after changes.
