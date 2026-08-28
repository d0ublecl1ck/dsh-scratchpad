/** Unit tests for src/fileset.js — shared-scratchpad attribution model. */

import { strict as assert } from "node:assert";
import { createTracker } from "../src/fileset.js";

const SP = "/tmp/sp";
const a = `${SP}/a.rs`;
const b = `${SP}/b.py`;
const c = `${SP}/src/c.js`;

const tracker = createTracker();

// event layer: observe attributes to the session and stamps the snapshot
assert.equal(tracker.observe("s1", a, 100), true);
assert.equal(tracker.observe("s1", b, 200), true);
assert.deepEqual([...tracker.filesOf("s1")].sort(), [a, b].sort());
assert.equal(tracker.globalSnapshot.get(a), 100);

// observing again with a new mtime counts as a change (still attributed)
assert.equal(tracker.observe("s1", a, 150), true);
assert.equal(tracker.globalSnapshot.get(a), 150);

// a second session sees the same snapshot but does not re-claim the file
const fresh = createTracker();
fresh.observe("sA", a, 100);
assert.equal(fresh.observe("sB", b, 200), true); // new for sB
assert.deepEqual(fresh.filesOf("sB"), [b]);
assert.deepEqual(fresh.filesOf("sA"), [a]);

// scan-layer diff: new files attributed to the triggering session only
const scan = createTracker();
scan.observe("sX", a, 100);
const fresh2 = scan.diff("sX", new Map([[a, 100], [c, 300]]));
assert.deepEqual(fresh2, [c]); // a unchanged; c is new
assert.deepEqual(scan.filesOf("sX").sort(), [a, c].sort());

// double-claim prevention: sY scans later and sees no deltas for a/c
const fresh3 = scan.diff("sY", new Map([[a, 100], [c, 300]]));
assert.deepEqual(fresh3, []);
assert.deepEqual(scan.filesOf("sY"), []);

// absent (delete) forgets from the global snapshot AND every session set
const track = createTracker();
track.observe("s1", a, 100);
track.observe("s2", a, 100); // s2 references the same file
track.forget(a);
assert.equal(track.globalSnapshot.has(a), false);
assert.deepEqual(track.filesOf("s1"), []);
assert.deepEqual(track.filesOf("s2"), []);

// forgetSession resets a session's set without touching others
const track2 = createTracker();
track2.observe("u1", a, 1);
track2.observe("u2", b, 2);
track2.forgetSession("u1");
assert.deepEqual(track2.filesOf("u1"), []);
assert.deepEqual(track2.filesOf("u2"), [b]);

// replaceSnapshot resets the global baseline (fresh scan)
const track3 = createTracker();
track3.observe("z1", a, 1);
track3.replaceSnapshot(new Map([[a, 1], [b, 2]]));
assert.deepEqual([...track3.globalSnapshot.keys()].sort(), [a, b].sort());

// removePath drops a path from the global snapshot and all sets
track3.removePath(a);
assert.equal(track3.globalSnapshot.has(a), false);

console.log("fileset-test: OK");