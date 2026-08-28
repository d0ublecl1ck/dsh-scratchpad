/**
 * dsh-scratchpad config — schema, path expansion, canonicalization, and the
 * isolation guard.
 *
 * Everything here is pure (no harness imports) so it is unit-testable with
 * plain node.
 *
 * @module dsh-scratchpad/config
 */

import { z } from "zod";
import path from "node:path";
import os from "node:os";

/**
 * Schemastery/zod config schema. The plugin works without the patch because
 * every field defaults; the deployment may override via `cordis.patch.yml`.
 */
export const Config = z.object({
  /** Shared free-chat directory. Empty string resolves to ${DSH_HOME:-~/.dsh}/scratchpad */
  scratchpadPath: z.string().default(""),
  /** Isolated project-root directory (sibling of scratchpad, never a child). Empty string resolves to ${DSH_HOME:-~/.dsh}/projects */
  projectsPath: z.string().default(""),
  /** Whether a session that produces files should be auto-promoted into an isolated project workspace. */
  autoPromote: z.boolean().default(true),
  /** Max length of the human-readable slug segment (before collision suffix). */
  slugMaxLen: z.number().int().min(4).max(24).default(8),
});

/** `~` in a config path resolves to the user home (os.homedir). */
export function expandTilde(value) {
  if (typeof value !== "string" || value.length === 0) return value;
  if (value === "~") return os.homedir();
  if (value.startsWith("~/") || value.startsWith("~\\")) {
    return path.join(os.homedir(), value.slice(2));
  }
  return value;
}

/** Effective DSH home directory: $DSH_HOME, else ~/.dsh. */
export function dshHome() {
  const env = typeof process !== "undefined" ? process.env.DSH_HOME : undefined;
  return env && env.length > 0 ? env : path.join(os.homedir(), ".dsh");
}

/** Default scratchpad directory under the DSH home. */
export function defaultScratchpadPath() {
  return path.join(dshHome(), "scratchpad");
}

/** Default projects root under the DSH home (sibling of scratchpad). */
export function defaultProjectsPath() {
  return path.join(dshHome(), "projects");
}

/** Normalize an absolute path for comparison: join + resolve (no symlink). */
export function normalizePath(value) {
  return path.resolve(value);
}

/**
 * Resolve the effective resolved config to absolute canonical paths:
 * expands `~`/`DSH_HOME` defaults, resolves to absolute, and enforces the
 * isolation invariant — `projectsPath` must not equal or nest inside
 * `scratchpadPath`, or the PRD's headline isolation guarantee is silently
 * violated.
 *
 * @param {object} raw - validated Config output (or a partial object).
 * @returns {{ scratchpadPath: string, projectsPath: string, autoPromote: boolean, slugMaxLen: number }}
 * @throws {Error} when the isolation invariant is violated.
 */
export function resolveConfig(raw = {}) {
  const parsed = Config.parse(raw);
  const scratchpad = normalizePath(
    expandTilde(parsed.scratchpadPath && parsed.scratchpadPath !== "" ? parsed.scratchpadPath : defaultScratchpadPath()),
  );
  const projects = normalizePath(
    expandTilde(parsed.projectsPath && parsed.projectsPath !== "" ? parsed.projectsPath : defaultProjectsPath()),
  );
  if (projects === scratchpad) {
    throw new Error(
      `dsh-scratchpad: projectsPath (${projects}) must differ from scratchpadPath (${scratchpad}) — the promoted projects must live outside the shared scratchpad`,
    );
  }
  const rel = path.relative(scratchpad, projects);
  if (rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel))) {
    throw new Error(
      `dsh-scratchpad: projectsPath (${projects}) must not be inside scratchpadPath (${scratchpad}) — the promoted projects must be an isolated sibling, not a child`,
    );
  }
  return {
    scratchpadPath: scratchpad,
    projectsPath: projects,
    autoPromote: parsed.autoPromote,
    slugMaxLen: parsed.slugMaxLen,
  };
}

/** True when `child` is equal to or strictly inside `parent` (both absolute). */
export function isWithin(child, parent) {
  const rel = path.relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}