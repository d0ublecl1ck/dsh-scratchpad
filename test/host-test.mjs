/**
 * Host-half integration test: mounts the plugin against stubbed harness
 * services and exercises the real `/scratchpad/open` route (idempotency),
 * the fs/observed event layer (in/out-of-scratchpad filtering, per-session
 * attribution, once-per-session promotion), and the `/scratchpad` command.
 */

import { strict as assert } from "node:assert";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { apply } from "../src/index.js";

// Canonicalize the temp root before use: `os.tmpdir()` is a symlinked path on
// macOS (/var → /private/var), while the plugin realpaths its configured roots
// at startup. A raw tmpdir would make every session cwd look outside the
// scratchpad and silently disable detection, failing the test for a reason
// that has nothing to do with the plugin.
const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "sp-host-")));
const scratchpad = path.join(root, "scratchpad");
const projects = path.join(root, "projects");

// --- captured registrations & listeners --------------------------------------
const routes = [];
const commands = [];
const listeners = {}; // event name → handler
let effectFns = [];

function makeAgent(sessionId, cwd) {
  const messages = sessionId === "s-artifact" ? [{ role: "user", content: [{ type: "text", text: "Build a data pipeline" }] }] : [];
  return {
    session: {
      id: sessionId,
      header: { cwd },
      deriveMessages: () => messages,
    },
  };
}

const createdWorkspaces = [];
const ctx = {
  workspaceRegistry: {
    create: async (p, title) => {
      assert.equal((await fs.stat(p)).isDirectory(), true, "dir must exist before create");
      const ws = { id: `ws-${path.basename(p)}`, title };
      createdWorkspaces.push({ id: ws.id, path: p, title });
      return ws;
    },
    resolveByPath: async () => undefined,
  },
  webServer: { register: (route) => { routes.push(route); return () => {}; } },
  commands: { register: (definition) => { commands.push(definition); return () => {}; } },
  sessions: {
    create: async (id, opts) => ({ id: "new-" + (opts?.meta?.cwd ? path.basename(opts.meta.cwd) : "x") }),
  },
  sessionQuery: { readSession: async () => ({ events: [] }) },
  fs: {
    processPath: (target) => (typeof target === "string" ? target : target?.processPath ?? target?.displayPath ?? target?.path),
  },
  timer: {
    debounce: (fn) => { ctx.timer.debounce.lastRun = fn; const d = { dispose: () => { d.disposed = true; }, run: fn, disposed: false }; return d; },
  },
  agents: { list: () => [] },
  logger: { warn: () => {}, info: () => {} },
  on: (event, handler) => { listeners[event] = handler; return () => { delete listeners[event]; }; },
  effect: (fn) => { effectFns.push(fn); const disposer = fn(); return disposer; },
};

const config = { scratchpadPath: scratchpad, projectsPath: projects, autoPromote: true, slugMaxLen: 8 };
apply(ctx, config);

// --- registration shape --------------------------------------------------------
assert.equal(routes.length, 1);
assert.equal(routes[0].kind, "prefix");
assert.equal(routes[0].path, "/scratchpad");
assert.equal(commands.length, 2, "/scratchpad + /scratchpad-tidy");
assert.deepEqual(
  commands.map((c) => c.name),
  ["scratchpad", "scratchpad-tidy"],
  "command names must match DSH's /^[a-z][a-z0-9_-]*$/u (spaces crash the plugin tree)",
);
assert.ok(listeners["fs/observed"], "fs/observed listener registered");
assert.ok(listeners["agent/turn-stopping"], "turn-stopping listener registered");

// --- init: scratchpad workspace created once, dir exists -----------------------
await new Promise((r) => setTimeout(r, 50));
assert.ok(createdWorkspaces.some((w) => w.path === scratchpad), "scratchpad workspace created at startup");
const scratchpadWorkspace = createdWorkspaces.find((w) => w.path === scratchpad);
assert.equal(scratchpadWorkspace.title, "自由对话");

// --- /scratchpad/open: idempotent ----------------------------------------------
function serve(routeIdx, url, method = "GET") {
  return new Promise((resolve) => {
    let status = 0;
    let body = "";
    const res = {
      writeHead: (code) => { status = code; },
      end: (chunk) => { body = chunk === undefined ? "" : String(chunk); resolve({ status, body }); },
    };
    routes[0].handler({ url, method, socket: { once: () => {} } }, res);
  });
}

const open1 = JSON.parse((await serve(0, "/scratchpad/open")).body);
assert.equal(open1.workspaceId, scratchpadWorkspace.id);
const open2 = JSON.parse((await serve(0, "/scratchpad/open")).body);
assert.equal(open2.workspaceId, scratchpadWorkspace.id, "open is idempotent");
assert.equal((await serve(0, "/scratchpad/other")).status, 404);

// --- fs/observed event layer -----------------------------------------------------
const observed = listeners["fs/observed"];
const insideFile = path.join(scratchpad, "report.md");
const outsideFile = path.join(root, "other", "x.txt");
await fs.mkdir(path.dirname(outsideFile), { recursive: true });
await fs.writeFile(insideFile, "hello");
await fs.writeFile(outsideFile, "nope");

const agent = makeAgent("s-artifact", scratchpad);
observed({ processPath: insideFile }, { kind: "present", version: 1 }, { agent });
// outside-scratchpad target is ignored
observed({ processPath: outsideFile }, { kind: "present", version: 1 }, { agent });

// absent forgets: observe then forget
const tempFile = path.join(scratchpad, "temp.tmp");
await fs.writeFile(tempFile, "t");
observed({ processPath: tempFile }, { kind: "present", version: 1 }, { agent });
observed({ processPath: tempFile }, { kind: "absent" }, { agent });

// --- promotion: once per session -------------------------------------------------
await new Promise((r) => setTimeout(r, 50)); // allow debounce/promotion microtasks
const promotions = JSON.parse((await serve(0, "/scratchpad/promotions")).body).promotions;
assert.equal(promotions.length, 1, "one promotion for s-artifact");
assert.equal(promotions[0].sessionId, "s-artifact");
assert.ok(promotions[0].workspaceId.startsWith("ws-2026-"), promotions[0].workspaceId);
assert.ok(promotions[0].path.startsWith(projects), promotions[0].path);

// promoted project contains the copied artifact
const artDir = path.join(promotions[0].path, "artifacts");
assert.equal(await fs.readFile(path.join(artDir, "report.md"), "utf8"), "hello");
// original untouched (copy semantics)
assert.equal(await fs.readFile(insideFile, "utf8"), "hello");

// another file for the SAME session must NOT promote a second time
const again = path.join(scratchpad, "second.md");
await fs.writeFile(again, "two");
observed({ processPath: again }, { kind: "present", version: 1 }, { agent });
await new Promise((r) => setTimeout(r, 50));
const after = JSON.parse((await serve(0, "/scratchpad/promotions")).body).promotions;
assert.equal(after.length, 1, "promotion is once per session");

// --- scan layer: bash-created files (NO fs/observed event) --------------------
// A second scratchpad session with a bash-created file: the file appears on
// disk without any fs/observed emission; the agent/turn-stopping listener
// triggers the debounced scan which diffs the global snapshot and attributes
// the file to this session.
const bashAgent = makeAgent("s-bash", scratchpad);
const bashFile = path.join(scratchpad, "bash-made.txt");
await fs.writeFile(bashFile, "bash"); // no observed() call — mimics bash heredoc
listeners["agent/turn-stopping"]({ agent: bashAgent });
await new Promise((r) => setTimeout(r, 30)); // debounce run
const debounceEntry = ctx.timer.debounce.lastRun;
// The debounce stub in this test records run() calls; run the scan synchronously.
await ctx.timer.debounce.lastRun();
await new Promise((r) => setTimeout(r, 30)); // promote microtasks
const bashPromotions = JSON.parse((await serve(0, "/scratchpad/promotions")).body).promotions;
assert.equal(bashPromotions.length, 2, "bash-created file promoted for s-bash");
const bashRecord = bashPromotions.find((p) => p.sessionId === "s-bash");
assert.ok(bashRecord, "s-bash promoted");
assert.equal(
  await fs.readFile(path.join(bashRecord.path, "artifacts", "bash-made.txt"), "utf8"),
  "bash",
  "bash artifact copied into promoted project",
);
// double-claim prevention: the scan for a THIRD session finds no deltas
const thirdAgent = makeAgent("s-third", scratchpad);
listeners["agent/turn-stopping"]({ agent: thirdAgent });
await ctx.timer.debounce.lastRun();
await new Promise((r) => setTimeout(r, 30));
const thirdPromotions = JSON.parse((await serve(0, "/scratchpad/promotions")).body).promotions;
assert.equal(thirdPromotions.length, 2, "third session does not double-claim existing files");

// --- /scratchpad command ----------------------------------------------------------
const cmd = commands.find((c) => c.name === "scratchpad");
const result = await cmd.handler({});
assert.equal(result.kind, "success");
assert.ok(result.text.includes(scratchpad), "command reports scratchpad path");
assert.ok(result.text.includes(projects), "command reports projects path");
assert.ok(result.text.includes("Promotions"), "command reports promotion count");

await fs.rm(root, { recursive: true, force: true });
console.log("host-test: route, event layer, promotion and command all passed");