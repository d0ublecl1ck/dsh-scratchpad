/** Unit tests for src/promote.js — copy atomicity, collision, rollback, mkdir-then-create. */

import { strict as assert } from "node:assert";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { claimProjectDir, migrateFiles, copyFileWithCollision, promoteSession } from "../src/promote.js";

const root = await fs.mkdtemp(path.join(os.tmpdir(), "sp-promote-"));
const sp = path.join(root, "scratchpad");
const prj = path.join(root, "projects");
await fs.mkdir(sp, { recursive: true });
await fs.mkdir(prj, { recursive: true });

async function touch(abs, content = "x") {
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, content, "utf8");
}

// copyFileWithCollision: never overwrite; -1/-2 suffixes
const f1 = path.join(sp, "notes.md");
await touch(f1, "v1");
const c0 = await copyFileWithCollision(f1, prj);
assert.equal(c0, path.join(prj, "notes.md"));
assert.equal(await fs.readFile(c0, "utf8"), "v1");
const c1 = await copyFileWithCollision(f1, prj);
assert.equal(c1, path.join(prj, "notes-1.md"));
const c2 = await copyFileWithCollision(f1, prj);
assert.equal(c2, path.join(prj, "notes-2.md"));

// claimProjectDir: unique claims, EEXIST retry suffix
const d0 = await claimProjectDir(prj, "2026-08-23-foo");
assert.equal(d0, path.join(prj, "2026-08-23-foo"));
const d1 = await claimProjectDir(prj, "2026-08-23-foo");
assert.equal(d1, path.join(prj, "2026-08-23-foo-1"));
const d2 = await claimProjectDir(prj, "2026-08-23-foo");
assert.equal(d2, path.join(prj, "2026-08-23-foo-2"));

// migrateFiles: staging + publish under artifacts, relative structure preserved
const srcA = path.join(sp, "deep", "a.go");
const srcB = path.join(sp, "main.py");
await touch(srcA, "go");
await touch(srcB, "py");
const projectDir = await claimProjectDir(prj, "2026-08-23-proj");
const migrated = await migrateFiles([srcA, srcB], projectDir, sp);
assert.deepEqual(migrated.sort(), [
  path.join(projectDir, "artifacts", "deep", "a.go"),
  path.join(projectDir, "artifacts", "main.py"),
].sort());
assert.equal(await fs.readFile(path.join(projectDir, "artifacts", "deep", "a.go"), "utf8"), "go");
assert.equal(await fs.readFile(srcA, "utf8"), "go"); // originals untouched (copy semantics)
// staging temp dir is gone
const names = await fs.readdir(prj);
assert.ok(!names.some((n) => n.includes(".staging-")));

// migrateFiles skips vanished sources (copy semantics: a file that
// disappeared between scan and copy is not an error)
const skipDir = await claimProjectDir(prj, "2026-08-23-skip");
const skipped = await migrateFiles([path.join(sp, "does-not-exist.bin")], skipDir, sp);
assert.deepEqual(skipped, []);
assert.ok((await fs.stat(skipDir)).isDirectory(), "skip still publishes");

// promoteSession rolls back the claimed dir when registry.create fails
await touch(path.join(sp, "rollback.md"), "rb");
let createAttempts = 0;
const failingCtx = {
  workspaceRegistry: {
    create: async () => { createAttempts++; throw new Error("registry down"); },
  },
};
await assert.rejects(() => promoteSession({
  ctx: failingCtx,
  projectsRoot: prj,
  scratchpadRoot: sp,
  sessionId: "s-rb",
  files: [path.join(sp, "rollback.md")],
  config: { slugMaxLen: 8 },
  slugInput: { firstMessage: "Rollback", timeMs: new Date(2026, 7, 23).getTime() },
}));
assert.equal(createAttempts, 1);
const rbNames = await fs.readdir(prj);
assert.ok(!rbNames.some((n) => n.startsWith("2026-08-23-rollback")), "no orphaned project dir after registry failure");
assert.ok(!rbNames.some((n) => n.includes(".staging-")), "no staging dirs left");

// promoteSession: full flow — mkdir exists BEFORE workspaceRegistry.create
let createSeen = null;
const stubCtx = {
  workspaceRegistry: {
    create: async (p, title) => {
      // invariant: the directory must exist at create time
      const st = await fs.stat(p);
      assert.equal(st.isDirectory(), true);
      createSeen = { p, title };
      return { id: "ws-" + path.basename(p), title };
    },
  },
};
await touch(path.join(sp, "report.md"), "report");
const promoted = await promoteSession({
  ctx: stubCtx,
  projectsRoot: prj,
  scratchpadRoot: sp,
  sessionId: "s-1",
  files: [path.join(sp, "report.md")],
  config: { slugMaxLen: 8 },
  slugInput: { firstMessage: "Weekly report", timeMs: new Date(2026, 7, 23).getTime() },
  title: "Weekly Report",
});
assert.equal(createSeen.p, promoted.projectPath);
assert.equal(createSeen.title, "Weekly Report");
assert.ok(promoted.workspaceId.startsWith("ws-"));
assert.equal(await fs.readFile(path.join(promoted.projectPath, "artifacts", "report.md"), "utf8"), "report");

await fs.rm(root, { recursive: true, force: true });
console.log("promote-test: OK");