# dsh-scratchpad

**Workspace-free free chat for DeepSeek Harness.** Start a conversation without
picking a project directory: a persistent sidebar entry opens a shared
scratchpad workspace, every tool stays available, and sessions that produce
real files are automatically promoted into isolated sibling project workspaces
with a new-session handoff.

## What it does

| Capability | How |
|---|---|
| **One-click free chat** | `sidebar.footer.action` button 「自由对话」→ `GET /scratchpad/open` → `workspaces.startSession(workspaceId)` opens a blank session bound to the shared scratchpad. |
| **Shared default directory** | All free chats share `${DSH_HOME:-~/.dsh}/scratchpad/` (mkdir + `workspaceRegistry.create` at startup, idempotent). |
| **Fully open tools (no stripping)** | The plugin never restricts tools — bash, write/edit, web search etc. all work; safety stays with DSH's own sandbox + approval. |
| **Isolated artifact promotion** | When a session produces files, its file-set is **copied** (never moved — the scratchpad is shared) into `${DSH_HOME:-~/.dsh}/projects/<date>-<slug>` — a **sibling** of the scratchpad, never a child — registered as a new workspace, and a banner offers **「在新工作区打开」** (`workspaces.startSession(projectWorkspaceId)`) so you continue in a fresh session bound to the project. |
| **Detection** | Two layers: `fs/observed` + `fs/write-intent` events (exact absolute paths, attributed via the acting agent's session) plus a per-turn recursive scratchpad scan that catches files bash/subprocess created (bash emits no fs events). A single global snapshot prevents two sessions from double-claiming a file. |

## Why promote → new session (not "redirect")

A DSH session's `cwd` is fixed in its immutable `SessionHeader`, and workspace
membership is *derived* from that canonical `cwd` (`attachSession` validates
`realpath(header.cwd) === workspace.path`). There is no API to move a live
session to another workspace. Promotion therefore:

1. `mkdir` the projects root and atomically claim a unique
   `<date>-<slug>[-N]` directory (`mkdir({recursive:false})` + EEXIST retry);
2. copy the session's file-set in under a staging temp dir, then rename into
   place (`projects/<slug>/artifacts/`), **preserving each file's path
   relative to the scratchpad root** (so `scratchpad/src/a.go` lands at
   `artifacts/src/a.go` — no basename flattening, no collisions between
   same-named files in different subdirs); a half-copied project never
   reaches the registry (copy failure rolls the whole claimed dir back);
3. `workspaceRegistry.create(projectDir, title)` — only after the directory
   exists (the registry `realpath`s the path);
4. the client banner hands off to a **new session** in that workspace.

The scratchpad session stays put; originals remain in the shared scratchpad
(copy semantics) and can be cleaned with `/scratchpad tidy`.

## Requirements

- DSH with the **web profile** (the host half injects `workspaceRegistry`
  from `@deepseek-ai/dsh-workspace`, `webServer`, `commands`, `fs`, `timer`,
  `sessions`, `sessionQuery`, `agents` — all shipped in the web profile's
  base/web-app bundles; no extra composition rows needed).
- Dependency: `zod` and `@deepseek-ai/schemastery` (declared in
  `package.json`).

## Install

```bash
# from the npm registry
dsh plugin --profile web add -w @banana-peeljj12/dsh-scratchpad

# from a packed tarball / source checkout (development)
dsh plugin --profile web add -w link:/abs/path/to/dsh-scratchpad
```

Then restart `dsh web`. The sidebar's 「自由对话」 button appears next to the
settings entry.

## Configuration

In the web profile's `cordis.patch.yml` (or by merging this package's
`cordis.patch.yml`):

```yaml
- insert:
    - id: scratchpad
      name: '@banana-peeljj12/dsh-scratchpad'
      config:
        scratchpadPath: ''   # default ${DSH_HOME:-~/.dsh}/scratchpad
        projectsPath: ''     # default ${DSH_HOME:-~/.dsh}/projects
        autoPromote: true    # false: only the manual command stays active
        slugMaxLen: 8
```

Path rules enforced at load:

- `~` expands to the user home; `$DSH_HOME` (when set) replaces `~/.dsh`.
- canonical `projectsPath` **must not** equal or nest inside canonical
  `scratchpadPath` — the plugin throws a clear config error otherwise (the
  isolation invariant is the point).

## Development

```bash
node test/paths-test.mjs      # slug derivation, collisions, error classes
node test/config-test.mjs     # ~/DSH_HOME expansion, isolation guard
node test/fileset-test.mjs    # shared-scratchpad attribution, double-claim prevention
node test/promote-test.mjs    # copy atomicity + structure, collision, rollback, mkdir-then-create
node test/host-test.mjs       # mounted host half over stubbed services
```

The client half is a hand-written, zero-build browser bundle
(`lib/client.js`, `window.__ModuleLoader__.load` + react/jsx-runtime +
`dsh-client-ui-primitives`) registered through the public slot system —
no build step.

## Verify

```bash
node test/paths-test.mjs && node test/config-test.mjs && node test/fileset-test.mjs && node test/promote-test.mjs && node test/host-test.mjs
dsh web --dump-config | grep scratchpad    # row composed into the profile
curl 'http://127.0.0.1:3080/scratchpad/open'        # { "workspaceId": "…" } — idempotent twice
curl 'http://127.0.0.1:3080/scratchpad/promotions'  # { "promotions": […] }
```

Manual UI checklist:

1. Sidebar 「自由对话」 → a blank session in the scratchpad workspace opens.
2. Ask the agent to write a file (or run bash that creates one) → after the
   turn a banner appears: 产物已提升到独立工作区 … + 「在新工作区打开」.
3. Click it → a new session opens bound to `projects/<date>-<slug>`; the
   artifact is under `artifacts/`.
4. `/scratchpad` shows the paths, workspace id and promotion count;
   `/scratchpad tidy` (then `--apply`) removes originals that no other live
   scratchpad session still references.

## Design notes

- **Slot-only UI, zero shadowing** — `sidebar.footer.action` and
  `conversation.input.dock` are additive `list` slots (the former already
  co-occupied by other plugins); the plugin cannot break core UI and unloads
  cleanly (every host registration is a fiber effect).
- **Theme tokens only** — all colors are `--dsw-alias-*` variables;
  light/dark follows the shell for free (`color-scheme`).
- **Copy, never move** — the scratchpad is shared across sessions; moving
  files would break other live sessions' tool paths. Originals stay until a
  user-confirmed `/scratchpad tidy --apply`.
- **Rollback-safe promotion** — staging temp dir + rename publishes the
  project only when complete; registry-create failure rolls the claimed dir
  back; a new workspace is never registered pointing at a half-copied dir.

## Rollback / uninstall

Remove the plugin row (or `dsh plugin --profile web remove @banana-peeljj12/dsh-scratchpad`)
and restart. All host registrations (routes, commands, listeners) are fiber
effects and disappear; the registered workspaces stay usable as ordinary
workspaces, and no physical files are deleted.

MIT — see [LICENSE](./LICENSE).