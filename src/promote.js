/**
 * dsh-scratchpad promotion — the "create → copy-migrate → register → hand
 * off" flow that moves one session's produced artifacts from the shared
 * scratchpad into an isolated sibling project workspace.
 *
 * A session's `header.cwd` is immutable, and workspace membership is derived
 * from it, so a live session can never be re-bound to a new workspace. The
 * promotion therefore:
 *
 *   1. ensures the projects root exists;
 *   2. atomically claims a unique `<date>-<slug>[-N]` directory
 *      (`mkdir({recursive:false})` + EEXIST retry — the atomic claim);
 *   3. copies (never moves — the scratchpad is shared) the session's file-set
 *      into it, with `-1/-2` collision suffixes, staging under a temp dir and
 *      renaming into place so the registry never sees a half-copied project;
 *   4. on copy failure, removes the claimed directory and rethrows (rollback);
 *   5. only then calls `workspaceRegistry.create(projectDir, title)` — which
 *      `realpath`s the path and rejects nonexistent directories, so the
 *      directory MUST exist first.
 *
 * Pure-ish: depends on `node:fs/promises` and the caller-supplied `ctx`
 * (workspaceRegistry). Unit-testable over a temp FS with a stub registry.
 *
 * @module dsh-scratchpad/promote
 */

import fs from "node:fs/promises";
import path from "node:path";
import { isEexist, withCollisionSuffix } from "./paths.js";

/**
 * Copy one file into `destDir`, preserving its basename and applying a
 * collision suffix when the destination already exists (never overwrite).
 * @param {string} absSrc - absolute source file path.
 * @param {string} destDir - absolute destination directory (must exist pre-created).
 * @returns {Promise<string>} the absolute destination path written.
 */
export async function copyFileWithCollision(absSrc, destDir) {
  const base = path.basename(absSrc);
  for (let attempt = 0; ; attempt++) {
    const target = path.join(destDir, withCollisionSuffix(base, attempt));
    try {
      await fs.copyFile(absSrc, target, fs.constants.COPYFILE_EXCL);
      return target;
    } catch (error) {
      if (isEexist(error)) continue;
      throw error;
    }
  }
}

/**
 * Recursively copy `files` (absolute scratchpad paths) into the already
 * claimed (empty) `projectDir` atomically: copies land in a staging temp
 * dir first, then one rename publishes them under `projectDir/artifacts`.
 * Relative structure is preserved: each file's path relative to
 * `scratchpadRoot` is reproduced under `artifacts/`, so `scratchpad/src/a.go`
 * lands at `artifacts/src/a.go` (no basename flattening, no collisions
 * between same-named files in different subdirs). On failure both the
 * staging dir and the claimed project dir are removed (rollback), so a
 * half-copied project never reaches the workspace registry.
 *
 * @param {string[]} files - absolute paths under the scratchpad root.
 * @param {string} projectDir - absolute target directory; MUST already exist
 *   and be empty (claimed by {@link claimProjectDir}).
 * @param {string} scratchpadRoot - absolute scratchpad root; the common
 *   ancestor `files` are relative to. When a file is not inside it, the
 *   basename is used (safety fallback).
 * @returns {Promise<string[]>} absolute destination paths inside the project dir.
 */
export async function migrateFiles(files, projectDir, scratchpadRoot) {
  const staging = `${projectDir}.staging-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const created = [];
  try {
    await fs.mkdir(staging, { recursive: true });
    for (const src of files) {
      try {
        const stat = await fs.stat(src);
        if (!stat.isFile()) continue;
        const rel = scratchpadRoot && isInside(src, scratchpadRoot)
          ? path.relative(scratchpadRoot, src)
          : path.basename(src);
        const destDir = path.join(staging, path.dirname(rel));
        await fs.mkdir(destDir, { recursive: true });
        const dest = await copyFileWithCollision(src, destDir);
        created.push(dest);
      } catch (error) {
        if (error?.code === "ENOENT") continue; // vanished between scan and copy: skip
        throw error;
      }
    }
    // projectDir is already claimed (empty); publish the stage under it.
    await fs.rename(staging, path.join(projectDir, "artifacts"));
    return created.map((p) => path.join(projectDir, "artifacts", path.relative(staging, p)));
  } catch (error) {
    await fs.rm(staging, { recursive: true, force: true }).catch(() => {});
    await fs.rm(projectDir, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}

/** True when an absolute path is inside (or equal to) an absolute root. */
function isInside(child, parent) {
  const rel = path.relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

/**
 * Claim a unique project directory name under `projectsRoot`, retrying with
 * `-N` suffixes on EEXIST (the atomic slug claim; two concurrent promotions
 * never share a directory).
 * @param {string} projectsRoot - absolute projects root.
 * @param {string} slug - base `<date>-<short>` name.
 * @param {number} [maxAttempts=64]
 * @returns {Promise<string>} the claimed absolute directory (exists, empty).
 */
export async function claimProjectDir(projectsRoot, slug, maxAttempts = 64) {
  await fs.mkdir(projectsRoot, { recursive: true });
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const name = attempt === 0 ? slug : `${slug}-${attempt}`;
    const dir = path.join(projectsRoot, name);
    try {
      await fs.mkdir(dir, { recursive: false });
      return dir;
    } catch (error) {
      if (!isEexist(error)) throw error;
    }
  }
  throw new Error(`dsh-scratchpad: could not claim a project directory under ${projectsRoot} for slug "${slug}"`);
}

/**
 * Run the full promotion for one session.
 *
 * @param {object} options
 * @param {object} options.ctx - harness context with `workspaceRegistry`.
 * @param {string} options.projectsRoot - config projects path.
 * @param {string} options.scratchpadRoot - config scratchpad path (the common
 *   ancestor of the copied file-set; relative structure is preserved).
 * @param {string} options.sessionId - promoted session.
 * @param {string[]} options.files - absolute scratchpad paths to copy.
 * @param {{slugMaxLen: number}} options.config - slug config.
 * @param {{ firstMessage?: string, fallback?: number, timeMs?: number }} [options.slugInput] - slug guidance.
 * @param {string} [options.title] - workspace display title (defaults to the slug).
 * @returns {Promise<{ sessionId: string, workspaceId: string, title: string, projectPath: string }>}
 */
export async function promoteSession(options) {
  const { ctx, projectsRoot, scratchpadRoot, sessionId, files, config, slugInput = {}, title } = options;
  const { projectSlug } = await import("./paths.js");
  const slug = projectSlug({
    firstMessage: slugInput.firstMessage,
    fallback: slugInput.fallback,
    timeMs: slugInput.timeMs,
    slugMaxLen: config.slugMaxLen,
  });
  const projectDir = await claimProjectDir(projectsRoot, slug);
  await migrateFiles(files, projectDir, scratchpadRoot);
  // Registry create AFTER the directory exists (realpath semantics). If the
  // registration itself fails, roll the claimed directory back so no orphaned
  // unregistered project is left behind.
  let workspace;
  try {
    workspace = await ctx.workspaceRegistry.create(projectDir, title ?? slug);
  } catch (error) {
    await fs.rm(projectDir, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
  return {
    sessionId,
    workspaceId: workspace.id,
    title: workspace.title ?? slug,
    projectPath: projectDir,
  };
}