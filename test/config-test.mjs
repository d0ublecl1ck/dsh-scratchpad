/** Unit tests for src/config.js — path expansion, defaults, isolation guard. */

import { strict as assert } from "node:assert";
import path from "node:path";
import os from "node:os";
import { Config, expandTilde, dshHome, defaultScratchpadPath, defaultProjectsPath, resolveConfig } from "../src/config.js";

// schema defaults
const parsed = Config.parse({});
assert.equal(parsed.scratchpadPath, "");
assert.equal(parsed.projectsPath, "");
assert.equal(parsed.autoPromote, true);
assert.equal(parsed.slugMaxLen, 8);

// expandTilde
assert.equal(expandTilde("~"), os.homedir());
assert.equal(expandTilde("~/x"), path.join(os.homedir(), "x"));
assert.equal(expandTilde("/abs/path"), "/abs/path");
assert.equal(expandTilde(""), "");

// dshHome honors DSH_HOME, else ~/.dsh
const oldHome = process.env.DSH_HOME;
try {
  delete process.env.DSH_HOME;
  assert.equal(dshHome(), path.join(os.homedir(), ".dsh"));
  process.env.DSH_HOME = "/tmp/dsh-home";
  assert.equal(dshHome(), "/tmp/dsh-home");
} finally {
  if (oldHome === undefined) delete process.env.DSH_HOME;
  else process.env.DSH_HOME = oldHome;
}

// Defaults derive from the RESOLVED DSH home and are siblings. `dshHome()`
// is the single source of truth here on purpose: hardcoding ~/.dsh made this
// test fail for anyone running it from inside a harness, where DSH_HOME is
// ambient.
const home = dshHome();
assert.equal(defaultScratchpadPath(), path.join(home, "scratchpad"));
assert.equal(defaultProjectsPath(), path.join(home, "projects"));

// resolveConfig expands ~ and defaults
const resolved = resolveConfig({});
assert.equal(resolved.autoPromote, true);
assert.equal(resolved.slugMaxLen, 8);
assert.ok(resolved.scratchpadPath.endsWith(`${path.sep}scratchpad`));
assert.ok(resolved.projectsPath.endsWith(`${path.sep}projects`));
assert.notEqual(resolved.scratchpadPath, resolved.projectsPath);

// explicit paths
const custom = resolveConfig({
  scratchpadPath: "~/sp",
  projectsPath: "~/prj",
  autoPromote: false,
  slugMaxLen: 12,
});
assert.equal(custom.scratchpadPath, path.join(os.homedir(), "sp"));
assert.equal(custom.projectsPath, path.join(os.homedir(), "prj"));
assert.equal(custom.autoPromote, false);
assert.equal(custom.slugMaxLen, 12);

// isolation guard: projects inside scratchpad must throw
assert.throws(() => resolveConfig({
  scratchpadPath: "/tmp/sp",
  projectsPath: "/tmp/sp/projects",
}), /must not be inside/);
assert.throws(() => resolveConfig({
  scratchpadPath: "/tmp/sp",
  projectsPath: "/tmp/sp",
}), /must differ/);

// sibling is fine even when sharing a parent
const sibling = resolveConfig({
  scratchpadPath: "/tmp/base/scratchpad",
  projectsPath: "/tmp/base/projects",
});
assert.ok(sibling.scratchpadPath.endsWith("scratchpad"));

console.log("config-test: OK");