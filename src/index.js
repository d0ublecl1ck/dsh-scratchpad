/**
 * dsh-scratchpad — workspace-free free chat for DeepSeek Harness.
 *
 * Host half:
 *   - Ensures the shared scratchpad directory exists and registers it as a
 *     durable workspace at startup (mkdir FIRST — `workspaceRegistry.create`
 *     realpaths the path and rejects nonexistent directories).
 *   - Serves `/scratchpad/open` (mkdir + idempotent register → workspaceId,
 *     for the client sidebar button) and `/scratchpad/promotions` (the
 *     promotion records, for the client banner).
 *   - Registers `/scratchpad` and `/scratchpad-tidy` commands.
 *   - Detects artifacts with two layers: the `fs/observed`/`fs/write-intent`
 *     event layer (exact absolute paths, attributed via `exec.agent`'s
 *     session) and a per-turn scan layer (recursive scratchpad diff) that
 *     catches bash/subprocess-created files, which emit no fs events.
 *   - Auto-promotes a session's file-set into an isolated sibling project
 *     workspace (copy, never move) once per session, then hands off to a NEW
 *     session in that workspace — a live session's cwd cannot change.
 *
 * Every registration is a fiber effect, so unloading the plugin removes all
 * routes, commands, and listeners.
 *
 * @module dsh-scratchpad
 */

import fs from "node:fs/promises";
import path from "node:path";
import { Config, resolveConfig } from "./config.js";
import { createTracker } from "./fileset.js";
import { isWithin } from "./config.js";
import { promoteSession } from "./promote.js";
import { slugify } from "./paths.js";

export const name = "scratchpad";

/**
 * Hard dependencies. `workspaceRegistry`, `webServer`, `commands`, `sessions`
 * (new-session handoff), `sessionQuery` (first-message slug source fallback),
 * `fs` (processPath on observed targets), `timer` (debounced scans) and
 * `agents` (agent→session lookup). All ship in the web profile's bundles.
 */
export const inject = [
  "workspaceRegistry", "webServer", "commands",
  "sessions", "sessionQuery", "fs", "timer", "agents",
];

/**
 * Extract plain text from a derived message's content blocks.
 * @param {object} message - derived message {role, content}.
 * @returns {string} concatenated text-block text.
 */
function textOf(message) {
  if (!message || !Array.isArray(message.content)) return "";
  const parts = [];
  for (const block of message.content) {
    if (block && typeof block.text === "string") parts.push(block.text);
  }
  return parts.join(" ").trim();
}

/**
 * First user message of a live session, from the agent's session messages.
 * @param {object} agents - the harness agents service.
 * @param {object} agent - an Agent (from exec.agent / turn payloads).
 * @returns {string} trimmed text, possibly empty.
 */
function firstUserMessageOf(agents, agent) {
  try {
    const live = agent?.session;
    if (!live || typeof live.deriveMessages !== "function") return "";
    for (const message of live.deriveMessages()) {
      if (message?.role === "user") {
        const text = textOf(message);
        if (text.length > 0) return text;
      }
    }
  } catch {
    // Best-effort: fall back to the counter slug.
  }
  return "";
}

/**
 * Host plugin apply.
 * @param {object} ctx - injected services.
 * @param {object} rawConfig - validated/defaulted config from the loader.
 */
export function apply(ctx, rawConfig = {}) {
  const config = resolveConfig(rawConfig);
  const { scratchpadPath, projectsPath, autoPromote, slugMaxLen } = config;
  const tracker = createTracker();

  /** sessionId → { workspaceId, title, projectPath } promotion records. */
  const promotions = new Map();
  /** Sessions already promoted (once per session). */
  const promotedSessions = new Set();
  /** sessionId → debounced scan handle (timer). */
  const scanDebounce = new Map();

  // ------------------------------------------------------------------ init
  // Canonical (realpath'd) roots. `workspaceRegistry.create` stores the
  // realpath of the directory, and session cwds derive from it, so on hosts
  // whose home path contains a symlink (macOS /var→/private/var, WSL
  // /tmp→/mnt/wsl/…, …) a plain `path.resolve` config root would never match
  // the sessions' canonical cwds and detection would silently miss. Resolve
  // both roots through the filesystem once at startup (after mkdir — realpath
  // rejects nonexistent paths), falling back to the resolved path when the
  // filesystem cannot canonicalize.
  let canonicalScratchpad = scratchpadPath;
  let canonicalProjects = projectsPath;

  async function canonicalizeRoots() {
    try {
      canonicalScratchpad = await fs.realpath(scratchpadPath);
    } catch {
      canonicalScratchpad = scratchpadPath;
    }
    try {
      canonicalProjects = await fs.realpath(projectsPath);
    } catch {
      canonicalProjects = projectsPath;
    }
  }

  async function ensureScratchpad() {
    await fs.mkdir(scratchpadPath, { recursive: true });
    const workspace = await ctx.workspaceRegistry.create(scratchpadPath, "自由对话");
    return workspace;
  }
  void ensureScratchpad()
    .then(() => canonicalizeRoots())
    .catch((error) => {
      ctx.logger?.warn?.(`dsh-scratchpad: scratchpad init failed (${error?.message ?? error})`);
    });

  // ------------------------------------------------------------- recursion
  /**
   * Recursively walk `root`, returning a Map<absPath, mtimeMs> for files.
   * Unreadable entries are skipped, never fatal.
   */
  async function recursiveSnapshot(root) {
    const entries = new Map();
    async function walk(dir) {
      let names;
      try {
        names = await fs.readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of names) {
        const abs = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === "artifacts") continue; // promoted project payloads are not scratchpad drafts
          await walk(abs);
        } else if (entry.isFile() || entry.isSymbolicLink()) {
          try {
            const stat = await fs.stat(abs);
            entries.set(abs, stat.mtimeMs);
          } catch {
            /* vanished between readdir and stat */
          }
        }
      }
    }
    await walk(root);
    return entries;
  }

  /** True when a session's cwd resolves (conceptually) inside the scratchpad root. */
  function sessionInScratchpad(agent) {
    const cwd = agent?.session?.header?.cwd;
    return typeof cwd === "string" && cwd.length > 0 && isWithin(path.resolve(cwd), canonicalScratchpad);
  }

  // ------------------------------------------------------------ scan layer
  /** Run a scan diff for one session, attributing new files to it. */
  async function scanForSession(sessionId, agent) {
    const snapshot = await recursiveSnapshot(canonicalScratchpad);
    const fresh = tracker.diff(sessionId, snapshot);
    if (fresh.length === 0) return;
    maybePromote(sessionId, agent);
  }

  /** Debounced scan trigger (catches bash-created files at turn end). */
  function scheduleScan(sessionId, agent) {
    if (!agent || !sessionInScratchpad(agent)) return;
    const existing = scanDebounce.get(sessionId);
    if (existing !== undefined) existing.dispose?.();
    const debounced = ctx.timer.debounce(() => {
      scanDebounce.delete(sessionId);
      void scanForSession(sessionId, agent).catch((error) => {
        ctx.logger?.warn?.(`dsh-scratchpad: scan failed (${error?.message ?? error})`);
      });
    }, 1500);
    scanDebounce.set(sessionId, debounced);
  }

  // ------------------------------------------------------- promotion logic
  /** Once-per-session promotion of the session's attributed file-set. */
  async function promoteIfReady(sessionId, agent, files) {
    if (!autoPromote || promotedSessions.has(sessionId) || files.length === 0) return;
    promotedSessions.add(sessionId);
    try {
      const slugInput = { firstMessage: firstUserMessageOf(ctx.agents, agent) };
      const record = await promoteSession({
        ctx,
        projectsRoot: canonicalProjects,
        scratchpadRoot: canonicalScratchpad,
        sessionId,
        files,
        config: { slugMaxLen },
        slugInput,
      });
      promotions.set(sessionId, record);
      tracker.forgetSession(sessionId);
      ctx.logger?.info?.(
        `dsh-scratchpad: promoted session ${sessionId} → ${record.projectPath} (workspace ${record.workspaceId})`,
      );
    } catch (error) {
      // Rollback is internal to promoteSession; allow a later retry if the
      // failure was transient, but keep the once-per-session guard honest:
      // clear it so a future artifact batch can promote again.
      promotedSessions.delete(sessionId);
      ctx.logger?.warn?.(`dsh-scratchpad: promotion failed (${error?.message ?? error})`);
    }
  }

  function maybePromote(sessionId, agent) {
    const files = tracker.filesOf(sessionId);
    if (files.length === 0) return;
    void promoteIfReady(sessionId, agent, files);
  }

  // ------------------------------------------------------------ event layer
  ctx.on("fs/observed", (target, observation, exec) => {
    if (observation?.kind !== "present") {
      // absent: forget the path from every session's file-set.
      const abs = ctx.fs.processPath(target);
      if (typeof abs === "string" && isWithin(abs, canonicalScratchpad)) tracker.forget(abs);
      return;
    }
    const abs = ctx.fs.processPath(target);
    if (typeof abs !== "string" || !isWithin(abs, canonicalScratchpad)) return;
    const agent = exec?.agent;
    if (!agent || !sessionInScratchpad(agent)) return;
    const sessionId = agent.session?.id;
    if (!sessionId) return;
    const changed = tracker.observe(sessionId, abs, observation?.version ?? Date.now());
    if (changed) {
      scheduleScan(sessionId, agent); // a sibling file may have been created by the same agent
      maybePromote(sessionId, agent);
    }
  });

  ctx.on("fs/write-intent", async (target, actor, next) => {
    // Waterfall: observe pre-write visibility for file tools, keep the flow.
    const agent = actor?.agent;
    if (agent && sessionInScratchpad(agent)) {
      const abs = ctx.fs.processPath(target);
      if (typeof abs === "string" && isWithin(abs, canonicalScratchpad)) {
        const sessionId = agent.session?.id;
        if (sessionId) {
          try {
            await fs.stat(abs);
            tracker.observe(sessionId, abs, Date.now());
          } catch {
            /* not yet present — it will arrive via fs/observed post-write */
          }
        }
      }
    }
    return next();
  });

  ctx.on("agent/turn-stopping", ({ agent }) => {
    if (agent && sessionInScratchpad(agent)) {
      scheduleScan(agent.session?.id, agent);
    }
  });

  ctx.on("tools/result", (exec) => {
    const agent = exec?.agent;
    if (agent && sessionInScratchpad(agent)) {
      const sessionId = agent.session?.id;
      if (sessionId) scheduleScan(sessionId, agent);
    }
  });

  // ---------------------------------------------------------------- routes
  ctx.effect(() => ctx.webServer.register({
    kind: "prefix",
    path: "/scratchpad",
    handler: async (req, res) => {
      try {
        const url = new URL(req.url ?? "/", "http://x");
        const pathname = decodeURIComponent(url.pathname);
        if (pathname === "/scratchpad/open" && (req.method === "GET" || req.method === "HEAD")) {
          const workspace = await ensureScratchpad();
          const body = Buffer.from(JSON.stringify({ workspaceId: workspace.id }), "utf8");
          res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
          res.end(req.method === "HEAD" ? undefined : body);
          return;
        }
        if (pathname === "/scratchpad/promotions" && (req.method === "GET" || req.method === "HEAD")) {
          const body = Buffer.from(JSON.stringify({
            promotions: [...promotions.entries()].map(([sessionId, record]) => ({
              sessionId,
              workspaceId: record.workspaceId,
              title: record.title,
              path: record.projectPath,
            })),
          }), "utf8");
          res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
          res.end(req.method === "HEAD" ? undefined : body);
          return;
        }
        res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
        res.end("not found");
      } catch (error) {
        ctx.logger?.warn?.(error);
        res.writeHead(500, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: String(error?.message ?? error) }));
      }
    },
  }), "dsh-scratchpad: /scratchpad routes");

  // -------------------------------------------------------------- commands
  ctx.effect(() => ctx.commands.register({
    name: "scratchpad",
    description: "workspace-free chat: show scratchpad/projects paths, promotion count and registered workspaces",
    handler: async () => {
      try {
        const workspace = await ensureScratchpad();
        const lines = [
          `Scratchpad ${scratchpadPath}`,
          `Projects   ${projectsPath}`,
          `Workspace  ${workspace.id} (${workspace.title ?? "自由对话"})`,
          `Promotions ${promotions.size}`,
        ];
        for (const record of promotions.values()) {
          lines.push(`  · ${record.title} → ${record.projectPath} (${record.workspaceId})`);
        }
        return { kind: "success", text: lines.join("\n") };
      } catch (error) {
        return { kind: "error", text: `scratchpad: ${error?.message ?? error}` };
      }
    },
  }), "dsh-scratchpad: /scratchpad command");

  ctx.effect(() => ctx.commands.register({
    name: "scratchpad-tidy",
    description: "list-or-remove promoted artifact originals still left in the shared scratchpad (never removes files another live scratchpad session still references)",
    handler: async ({ args }) => {
      const applyClean = String(args?.[0] ?? "") === "--apply";
      // Promoted projects mirror their files under `artifacts/` preserving each
      // file's path relative to the scratchpad root (scratchpad/src/a.go →
      // projects/<slug>/artifacts/src/a.go), so a copied artifact's path
      // relative to `artifacts/` IS its original path relative to the
      // scratchpad root. Reconstruct originals by that same relative walk.
      const liveScratchpadSessions = ctx.agents?.list?.()?.filter((agent) => sessionInScratchpad(agent)) ?? [];
      const referenced = new Set();
      for (const agent of liveScratchpadSessions) {
        const id = agent.session?.id;
        if (id) for (const file of tracker.filesOf(id)) referenced.add(path.resolve(file));
      }
      const removable = [];
      for (const record of promotions.values()) {
        const artifactsDir = path.join(record.projectPath, "artifacts");
        async function walkArtifacts(dir) {
          let names;
          try {
            names = await fs.readdir(dir, { withFileTypes: true });
          } catch {
            return;
          }
          for (const entry of names) {
            const abs = path.join(dir, entry.name);
            if (entry.isDirectory()) {
              await walkArtifacts(abs);
              continue;
            }
            if (!entry.isFile() && !entry.isSymbolicLink()) continue;
            const rel = path.relative(artifactsDir, abs);
            const original = path.join(canonicalScratchpad, rel);
            if (referenced.has(path.resolve(original))) continue;
            removable.push(original);
          }
        }
        await walkArtifacts(artifactsDir);
      }
      if (!applyClean) {
        if (removable.length === 0) return { kind: "success", text: "scratchpad-tidy: nothing to clean (run with --apply to remove)" };
        return {
          kind: "success",
          text: `scratchpad-tidy: ${removable.length} original(s) can be removed (run again with --apply):\n${removable.join("\n")}`,
        };
      }
      for (const file of removable) {
        try { await fs.rm(file, { force: true }); } catch { /* keep going */ }
      }
      return { kind: "success", text: `scratchpad-tidy: removed ${removable.length} original(s) from ${canonicalScratchpad}` };
    },
  }), "dsh-scratchpad: /scratchpad-tidy command");
}