/**
 * dsh-scratchpad path helpers — slug derivation, sanitization, collision
 * suffixes, and ENOENT/EEXIST classification.
 *
 * Pure module (no harness imports, no I/O beyond the errors this module
 * classifies); unit-testable with plain node.
 *
 * @module dsh-scratchpad/paths
 */

/**
 * Local-time `yyyy-mm-dd` for a Unix epoch millisecond stamp.
 * @param {number} timeMs
 * @returns {string}
 */
export function localDay(timeMs) {
  const d = new Date(timeMs);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Character class kept in a slug segment: ASCII alnum, dash, underscore, dot. */
const SAFE = /[^a-zA-Z0-9._-]+/g;

/**
 * Sanitize a free-text segment into a filesystem-safe slug part: lowercase,
 * collapse unsafe runs to `-`, trim separators, cap at `maxLen`.
 * @param {string} text
 * @param {number} maxLen
 * @returns {string} possibly empty
 */
export function slugify(text, maxLen = 8) {
  const cleaned = String(text ?? "")
    .toLowerCase()
    .replace(SAFE, "-")
    .replace(/[-._]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (cleaned.length <= maxLen) return cleaned;
  return cleaned.slice(0, maxLen).replace(/-+$/g, "");
}

/**
 * Derive a project folder name: `<yyyy-mm-dd>-<short>` where `<short>` is a
 * sanitized <=slugMaxLen prefix of the first user message, or a fallback
 * counter label when no usable text exists.
 * @param {{ firstMessage?: string, timeMs?: number, fallback?: number, slugMaxLen?: number }} input
 * @returns {string} e.g. `2026-08-23-data-analy` or `2026-08-23-chat-2`
 */
export function projectSlug(input = {}) {
  const day = localDay(input.timeMs ?? Date.now());
  const maxLen = input.slugMaxLen ?? 8;
  let short = slugify(input.firstMessage ?? "", maxLen);
  if (short.length === 0) {
    const n = input.fallback ?? 1;
    short = `chat-${n}`.slice(0, maxLen + 5);
  }
  return `${day}-${short}`;
}

/** True when an error is a "path exists" EEXIST (as raised by fs.mkdir({recursive:false})). */
export function isEexist(error) {
  return Boolean(error && (error.code === "EEXIST" || error.code === "EACCES" && String(error.message).includes("EEXIST")));
}

/** True when an error is a "path missing" ENOENT. */
export function isEnOent(error) {
  return Boolean(error && error.code === "ENOENT");
}

/**
 * Append a collision suffix to a path's basename: `name`, `name-1`, `name-2`…
 * (used for per-file copies into a promoted project).
 * @param {string} filePath - absolute or relative path.
 * @param {number} attempt - 0 = plain, 1 = `-1`, 2 = `-2`, …
 * @returns {string} the same path with a suffixed basename.
 */
export function withCollisionSuffix(filePath, attempt) {
  if (attempt <= 0) return filePath;
  const dir = filePath.includes("/") ? filePath.slice(0, filePath.lastIndexOf("/")) : "";
  const base = filePath.slice(filePath.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  if (dot <= 0) return `${dir ? dir + "/" : ""}${base}-${attempt}`;
  return `${dir ? dir + "/" : ""}${base.slice(0, dot)}-${attempt}${base.slice(dot)}`;
}