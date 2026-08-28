/** Unit tests for src/paths.js — slug derivation, sanitization, collisions. */

import { strict as assert } from "node:assert";
import { localDay, slugify, projectSlug, isEexist, isEnOent, withCollisionSuffix } from "../src/paths.js";

const fixedTime = new Date(2026, 7, 23, 12, 0, 0).getTime(); // 2026-08-23 local

// localDay
assert.equal(localDay(fixedTime), "2026-08-23");
assert.equal(localDay(new Date(2026, 0, 5).getTime()), "2026-01-05");

// slugify: lowercase, unsafe runs → dash, trim, cap
assert.equal(slugify("Data Analysis Report", 8), "data-ana");
assert.equal(slugify("HTML/CSS 教程", 8), "html-css");
assert.equal(slugify("!!!  ", 8), "");
assert.equal(slugify("a".repeat(40), 8), "a".repeat(8));
assert.equal(slugify("  spaced  out  ", 10), "spaced-out");

// projectSlug
assert.equal(projectSlug({ firstMessage: "Build a web crawler", timeMs: fixedTime, slugMaxLen: 8 }), "2026-08-23-build-a");
assert.equal(projectSlug({ firstMessage: "", fallback: 2, timeMs: fixedTime, slugMaxLen: 8 }), "2026-08-23-chat-2");
assert.equal(projectSlug({ firstMessage: "中文对话", timeMs: fixedTime, slugMaxLen: 8 }), "2026-08-23-chat-1");
assert.ok(projectSlug({ firstMessage: "B", timeMs: fixedTime }).startsWith("2026-08-23-"));

// error classification
assert.equal(isEexist(Object.assign(new Error("x"), { code: "EEXIST" })), true);
assert.equal(isEexist(Object.assign(new Error("y"), { code: "ENOENT" })), false);
assert.equal(isEexist(null), false);
assert.equal(isEnOent(Object.assign(new Error("z"), { code: "ENOENT" })), true);

// collision suffix
assert.equal(withCollisionSuffix("/a/b.txt", 0), "/a/b.txt");
assert.equal(withCollisionSuffix("/a/b.txt", 1), "/a/b-1.txt");
assert.equal(withCollisionSuffix("/a/b.txt", 2), "/a/b-2.txt");
assert.equal(withCollisionSuffix("b.txt", 1), "b-1.txt");
assert.equal(withCollisionSuffix("/a/noext", 1), "/a/noext-1");

console.log("paths-test: OK");