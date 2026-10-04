# Manual verification (maintainer)

Run these against a real web profile before tagging a release. Automated suites
cannot see the rendered shell, so the sidebar is checked by hand (or with a
headless browser - see the commands at the bottom).

1. Wide sidebar: the 「自由对话」 button sits **beside** 新会话, both about half the
   sidebar width, on the same row.
2. Click it -> a blank session in the scratchpad workspace opens.
3. Collapse the sidebar (56px rail): the entry becomes a single icon button between
   the new-session and workspace icons, visually distinct from the new-session icon;
   clicking it behaves the same.
4. Light/dark theme switch -> the entry follows the theme.
5. Ask the agent to write a file (or run bash that creates one) -> after the turn a
   banner appears: 产物已提升到独立工作区 ... + 「在新工作区打开」.
6. Click it -> a new session opens bound to `projects/<date>-<slug>`; the artifact is
   under `artifacts/`.
7. `/scratchpad` shows the paths, workspace id and promotion count;
   `/scratchpad-tidy` (then `--apply`) removes originals that no other live
   scratchpad session still references.
8. Reload or remove the plugin -> the injected host DOM is removed with no residue in
   the sidebar; after a reload it comes back.

## Local smoke commands

```bash
dsh --profile web --dump-config | grep -A6 scratchpad   # row composed, name matches
curl 'http://127.0.0.1:43129/scratchpad/open'           # {"workspaceId": "..."} - idempotent twice
curl 'http://127.0.0.1:43129/scratchpad/promotions'     # {"promotions": [...]}
```

## Degrade paths worth re-checking after a shell upgrade

- The pairing keys off the CSS-module local name `newSession` on the shell's
  new-session button and on `:has()` support. If either moves, the entry silently
  falls back to the full-width section (still functional, different shape).
- Icons are resolved from a candidate list with an inline-SVG fallback; a missing
  name degrades to a plain glyph instead of a React #130 crash.
