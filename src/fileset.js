/**
 * dsh-scratchpad file-set tracking — the shared-scratchpad attribution model.
 *
 * The scratchpad is a SHARED directory across free-chat sessions, so a file's
 * existence cannot be attributed to a session from the filesystem alone.
 * Attribution comes from the two detection layers:
 *
 *   - Event layer (`fs/observed`): carries the acting tool-execution
 *     (`exec.agent` → session), so exact paths are attributed precisely.
 *   - Scan layer (end-of-turn diff): discovers files bash/subprocess created
 *     without fs events; the file is attributed to whichever session owned the
 *     triggering scan. One GLOBAL scratchpad snapshot prevents double-claim:
 *     a file discovered during session A's scan is recorded in the shared
 *     snapshot, so session B's later scan sees no delta for it.
 *
 * Each session keeps its own FILE-SET (the union of files attributed to it);
 * the SNAPSHOT (what currently exists in scratchpad) is global. Cross-session
 * edits to an already-claimed file (session B editing session A's file) are
 * harmless under copy semantics — the promoted project copies are snapshots,
 * and the accompanying comment documents the heuristic.
 *
 * Pure module; unit-testable with plain node.
 *
 * @module dsh-scratchpad/fileset
 */

/** Deep-freeze a plain snapshot map (path → mtimeMs). */
function freeze(entries) {
  return Object.freeze(Object.fromEntries(entries));
}

/**
 * Create a new tracker:
 * @returns {{
 *   fileSets: Map<string, Set<string>>,
 *   globalSnapshot: Map<string, number>,
 *   observe(sessionId, absPath, mtimeMs): boolean,
 *   forget(sessionId, absPath): void,
 *   diff(sessionId, entries): string[],
 *   replaceSnapshot(entries): void,
 *   filesOf(sessionId): string[],
 *   forgetSession(sessionId): void,
 *   removePath(absPath): void
 * }}
 */
export function createTracker() {
  /** sessionId → set of absolute paths attributed to that session. */
  const fileSets = new Map();
  /** absolute path → mtimeMs for everything observed in the scratchpad root. */
  const globalSnapshot = new Map();

  function sessionSet(sessionId) {
    let set = fileSets.get(sessionId);
    if (set === undefined) {
      set = new Set();
      fileSets.set(sessionId, set);
    }
    return set;
  }

  return {
    fileSets,
    globalSnapshot,

    /**
     * Record a present observation (event layer): attribute `absPath` to
     * `sessionId` (if given) and stamp the global snapshot mtime.
     * @returns {boolean} true when this path was newly attributed to the
     *   session (a new artifact) or its mtime moved (a changed artifact).
     */
    observe(sessionId, absPath, mtimeMs) {
      const previousMtime = globalSnapshot.get(absPath);
      const changed = previousMtime === undefined || previousMtime !== mtimeMs;
      globalSnapshot.set(absPath, mtimeMs);
      if (sessionId !== undefined && sessionId !== null) sessionSet(sessionId).add(absPath);
      return changed;
    },

    /**
     * Forget a path (event layer, `kind: absent`): drop it from the global
     * snapshot and from every session file-set that referenced it.
     */
    forget(absPath) {
      globalSnapshot.delete(absPath);
      for (const set of fileSets.values()) set.delete(absPath);
    },

    /**
     * Scan-layer diff: given the current recursive directory entries for the
     * scratchpad root (path → mtimeMs), return the newly-present paths and
     * attribute them to `sessionId`. Existing global-snapshot files are not
     * re-claimed by later sessions (single attribution).
     * @returns {string[]} absolute paths new or changed since the snapshot.
     */
    diff(sessionId, entries) {
      const fresh = [];
      for (const [absPath, mtimeMs] of entries) {
        const previous = globalSnapshot.get(absPath);
        if (previous === undefined || previous !== mtimeMs) {
          fresh.push(absPath);
          globalSnapshot.set(absPath, mtimeMs);
          if (sessionId !== undefined && sessionId !== null) sessionSet(sessionId).add(absPath);
        }
      }
      return fresh;
    },

    /** Replace the whole global snapshot (fresh recursive scan baseline). */
    replaceSnapshot(entries) {
      globalSnapshot.clear();
      for (const [absPath, mtimeMs] of entries) globalSnapshot.set(absPath, mtimeMs);
    },

    /** Current attributed files for one session (copy - callers must not mutate). */
    filesOf(sessionId) {
      return [...(fileSets.get(sessionId) ?? [])];
    },

    /** Reset the file-set (after a promotion consumed it). */
    forgetSession(sessionId) {
      fileSets.delete(sessionId);
    },

    /** Drop a path from snapshots/sets (used when a promoted original is cleaned). */
    removePath(absPath) {
      globalSnapshot.delete(absPath);
      for (const set of fileSets.values()) set.delete(absPath);
    },
  };
}