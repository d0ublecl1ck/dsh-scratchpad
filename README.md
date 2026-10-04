# dsh-scratchpad-plus

![MIT](https://img.shields.io/badge/license-MIT-blue) ![profile](https://img.shields.io/badge/DSH-web%20profile-informational) ![tests](https://img.shields.io/badge/npm%20test-7%2F7-brightgreen)

![The 自由对话 button beside the shell new-session button](docs/paired-entry.png)

**Workspace-free free chat for DeepSeek Harness.** Start a conversation without
picking a project directory: a button beside the sidebar's new-session button
opens a shared scratchpad workspace, every tool stays available, and sessions
that produce real files are automatically promoted into isolated sibling project
workspaces with a new-session handoff.

> **This is a maintained fork.** It is based on
> [`1264459640/dsh-scratchpad`](https://github.com/1264459640/dsh-scratchpad)
> (MIT), which has had no commits since 2026-08-30 and no longer works on
> current DeepSeek Harness. The upstream copyright notice is preserved in
> [LICENSE](./LICENSE).

## What this fork changes (relative to upstream 0.3.0)

| Change | Why |
|---|---|
| Starts sessions through `uiWorkspace.startSession`, not `workspaces.startSession` | `startSession` moved to the `uiWorkspace` service; upstream's call site no longer exists, so every click failed silently while the host quietly created blank sessions the sidebar never shows. Falls back to the old location on older harnesses, and reports the missing capability when neither exists. |
| Icons resolved by candidate name, with a bundled inline-SVG fallback | The primitives package renamed `IconXxx16` to `IconXxx<Weight><Size>`; upstream's icon references resolved to `undefined`, React threw #130, and the crash took down the whole sidebar entry. |
| The entry sits beside the shell's new-session button | Two 50% controls in one row instead of a full-width section above the workspace list. Upstream deliberately chose the section layout; this fork prefers the compact one. If the shell button cannot be located, the entry falls back to the section, then to a footer button. |
| Two test-harness fixes | `config-test` pinned `~/.dsh` (red for anyone running the suite inside a harness) and `host-test` used an uncanonicalized `os.tmpdir()` path (red on macOS). |

Everything else - the promotion pipeline, the commands, the configuration - is
upstream's work, unchanged.

## When you need it

- You want to try a prompt or prototype a script without deciding which project
directory it belongs to, and without littering the sidebar with one-off folders.
- You are mid-conversation and the agent needs to write a real file - you do not
want that file to land in a production checkout. Free chats live in a shared
scratchpad; anything worth keeping is promoted into its own workspace.
- You keep several throwaway conversations open at once and want them in one
place instead of mixed into your project list.

## What it does

| Capability | How |
|---|---|
| **One-click free chat** | A 「自由对话」 button paired with the shell new-session button (56px rail collapse: a single sparkle icon button) calls `GET /scratchpad/open`, then `uiWorkspace.startSession(workspaceId)` opens a blank session bound to the shared scratchpad. |
| **Shared default directory** | All free chats share `${DSH_HOME:-~/.dsh}/scratchpad/` (mkdir + `workspaceRegistry.create` at startup, idempotent). |
| **Fully open tools (no stripping)** | The plugin never restricts tools - bash, write/edit, web search etc. all work; safety stays with DSH's own sandbox + approval. |
| **Isolated artifact promotion** | When a session produces files, its file-set is **copied** (never moved - the scratchpad is shared) into `${DSH_HOME:-~/.dsh}/projects/<date>-<slug>` - a **sibling** of the scratchpad, never a child - registered as a new workspace, and a banner offers **「在新工作区打开」** (`uiWorkspace.startSession(projectWorkspaceId)`) so you continue in a fresh session bound to the project. |
| **Detection** | Two layers: `fs/observed` + `fs/write-intent` events (exact absolute paths, attributed via the acting agent's session) plus a per-turn recursive scratchpad scan that catches files bash/subprocess created (bash emits no fs events). A single global snapshot prevents two sessions from double-claiming a file. |

## Requirements

- DSH with the **web profile** (the host half injects `workspaceRegistry` from
  `@deepseek-ai/dsh-workspace`, `webServer`, `commands`, `fs`, `timer`,
  `sessions`, `sessionQuery`, `agents` - all shipped in the web profile's
  base/web-app bundles; no extra composition rows needed).
- Dependencies: `zod` and `@deepseek-ai/schemastery` (declared in `package.json`).
- The client half starts sessions through `uiWorkspace.startSession` and falls
  back to `workspaces.startSession` on harnesses that still expose the capability
  there. When neither exists the click reports the missing capability instead of
  silently doing nothing.
- Checked against the published `@deepseek-ai/dsh-client-ui-workspace` 0.1.7-rc.2
  and 0.2.1-alpha.1, and `@deepseek-ai/dsh-client-ui-primitives` 0.1.7-rc.2.

## Install

```bash
# from the npm registry
dsh plugin --profile web add -w dsh-scratchpad-plus

# from a source checkout (development)
dsh plugin --profile web add -w link:/abs/path/to/dsh-scratchpad-plus
```

Then restart `dsh web` or the DSH Desktop app. The 「自由对话」 button appears
next to the sidebar's 新会话 button; collapse the sidebar for a single icon button
between the new-session and workspace icons.

### Coming from the upstream package

```bash
dsh plugin --profile web remove @banana-peeljj12/dsh-scratchpad
dsh plugin --profile web add -w dsh-scratchpad-plus
```

Install only one of the two: both register the same loader row id (`scratchpad`)
and the same `/scratchpad` route prefix. Your data is untouched - this fork uses
the same `${DSH_HOME:-~/.dsh}/scratchpad` and `projects` directories, and existing
scratchpad workspaces keep working.

## Configuration

In the web profile's `cordis.patch.yml` (or by merging this package's
`cordis.patch.yml`):

```yaml
- insert:
    - id: scratchpad
      name: 'dsh-scratchpad-plus'
      config:
        scratchpadPath: ''   # default ${DSH_HOME:-~/.dsh}/scratchpad
        projectsPath: ''     # default ${DSH_HOME:-~/.dsh}/projects
        autoPromote: true    # false: only the manual command stays active
        slugMaxLen: 8
```

Path rules enforced at load:

- `~` expands to the user home; `$DSH_HOME` (when set) replaces `~/.dsh`.
- canonical `projectsPath` **must not** equal or nest inside canonical
  `scratchpadPath` - the plugin throws a clear config error otherwise (the
  isolation invariant is the point).

## Commands

| Command | What it does |
|---|---|
| `/scratchpad` | Prints the scratchpad and projects paths, the registered workspace id and the promotion count. |
| `/scratchpad-tidy` | Lists promoted originals still left in the shared scratchpad that no other live scratchpad session references. |
| `/scratchpad-tidy --apply` | Removes those originals. |

## Troubleshooting

- **The sidebar entry is missing.** Check the row is composed
  (`dsh --profile web --dump-config | grep scratchpad`), then reload the window
  (`Cmd+R`). A crashed entry logs `slot entry crashed in 'sidebar.footer.action'`
  in the browser console - that is what an icon rename looks like.
- **Clicking does nothing.** Look for `no startSession capability` in the browser
  console: the harness exposes neither `uiWorkspace.startSession` nor
  `workspaces.startSession`. On a harness this fork has not seen yet, please open
  an issue with the DSH version.
- **Sessions pile up without content.** Blank sessions are created by the host and
  are only visible while they are the current one; that is shell behaviour, not
  this plugin's.

## Why promote to a new session (not redirect)

A DSH session's `cwd` is fixed in its immutable `SessionHeader`, and workspace
membership is *derived* from that canonical `cwd` (`attachSession` validates
`realpath(header.cwd) === workspace.path`). There is no API to move a live
session to another workspace. Promotion therefore:

1. `mkdir` the projects root and atomically claim a unique `<date>-<slug>[-N]`
   directory (`mkdir({recursive:false})` + EEXIST retry);
2. copy the session's file-set in under a staging temp dir, then rename into place
   (`projects/<slug>/artifacts/`), **preserving each file's path relative to the
   scratchpad root** (so `scratchpad/src/a.go` lands at `artifacts/src/a.go` - no
   basename flattening, no collisions between same-named files in different
   subdirs); a half-copied project never reaches the registry (copy failure rolls
   the whole claimed dir back);
3. `workspaceRegistry.create(projectDir, title)` - only after the directory exists
   (the registry `realpath`s the path);
4. the client banner hands off to a **new session** in that workspace.

The scratchpad session stays put; originals remain in the shared scratchpad (copy
semantics) and can be cleaned with `/scratchpad-tidy`.

## Safety

- **Copy, never move.** Promotion copies the session's file-set out; originals
  stay in the scratchpad until you run `/scratchpad-tidy --apply`, which itself
  only lists files that no other live scratchpad session still references.
- **No tool stripping.** The plugin does not narrow what the agent may do; DSH's
  own sandbox and approval settings remain in charge.
- **Nothing is deleted on uninstall.** Removing the plugin removes its routes,
  commands and listeners; registered workspaces and their files stay put.
- **No outbound calls of its own.** The host half only talks to the harness
  (registry, web server, sessions) and the local filesystem.

## Development

```bash
npm ci
npm test                      # all suites
node test/open-session-test.mjs   # client half: starters, icons, placement
```

The client half is a hand-written, zero-build browser bundle (`lib/client.js`,
`window.__ModuleLoader__.load` + react/jsx-runtime + `dsh-client-ui-primitives`)
registered through the public slot system - no build step. `npm test` is expected
to be green on Linux and macOS, with or without an ambient `DSH_HOME`.

Maintainer-side manual checks live in [docs/manual-verification.md](./docs/manual-verification.md).

Reproducible render check (needs a running instance and Google Chrome):

```bash
DSH_HOME=~/.dsh node scripts/verify-render.mjs                       # dsh web on :3080
DSH_HOME="$HOME/Library/Application Support/dsh-desktop/harness" \
  node scripts/verify-render.mjs --host 127.0.0.1:43129              # DSH Desktop
```

It navigates headlessly, asserts that the host node is injected directly after
 the shell's new-session button, that the two share a row with comparable
widths, and that no slot entry crashed.

| Path | What it is |
|---|---|
| `src/` | Host half: config, paths, file-set tracking, promotion |
| `lib/client.js` | Zero-build browser bundle (no compile step) |
| `test/` | Unit + integration suites (`npm test`) |
| `scripts/verify-render.mjs` | Headless render check against a live instance |
| `docs/` | Maintainer checklist and the screenshot above |

## Design notes

- **Paired entry via anchor + portal (reviewed DOM injection)** - the slot system
  has no sidebar-section slot, so the client keeps a `display:none` anchor inside
  its `sidebar.footer.action` registration, resolves the sidebar root through an
  explicit per-step criteria chain (`closest('[data-slot="sidebar.footer.action"]')`
  -> footerActions -> footArea -> root), and inserts a `flex:none` host div directly
  after the shell's new-session button. CSS `:has(> .sp_pairHost)` turns the sidebar
  column into a two-column grid for exactly those two children - the React-owned
  button is never reparented. `createPortal` renders into the host, so locales and
  contexts keep working. Every failed criterion degrades **visibly**: paired ->
  full-width section before the workspaces region -> footer button. The host carries
  a data mark for idempotent reuse and an owner token so unmount/HMR cleanup never
  leaves residue.
- **Slot-only UI, zero shadowing** - `sidebar.footer.action` and
  `conversation.input.dock` are additive `list` slots; the plugin registers nothing
  into `sidebar.workspaces`/`sidebar.settings` (both `single`) and so cannot shadow
  core UI or other plugins; unloads cleanly (every host registration is a fiber
  effect).
- **Theme tokens only** - all colors are `--dsw-alias-*` variables; light/dark
  follows the shell for free (`color-scheme`).
- **Copy, never move** - the scratchpad is shared across sessions; moving files
  would break other live sessions' tool paths. Originals stay until a user-confirmed
  `/scratchpad-tidy --apply`.
- **Rollback-safe promotion** - staging temp dir + rename publishes the project only
  when complete; registry-create failure rolls the claimed dir back; a new workspace
  is never registered pointing at a half-copied dir.

## Rollback / uninstall

Remove the plugin row (or `dsh plugin --profile web remove dsh-scratchpad-plus`) and
restart. All host registrations (routes, commands, listeners) are fiber effects and
disappear; the registered workspaces stay usable as ordinary workspaces, and no
physical files are deleted.

## License

MIT. Forked from [`1264459640/dsh-scratchpad`](https://github.com/1264459640/dsh-scratchpad);
see [LICENSE](./LICENSE) for both copyright notices.
