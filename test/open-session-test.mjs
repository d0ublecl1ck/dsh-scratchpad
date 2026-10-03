/**
 * Client-half session-starter test: opening a scratchpad session must call
 * the capability the running harness actually exposes.
 *
 * The harness moved "start a session in this workspace" from the workspaces
 * controller to `uiWorkspace`; calling it on the wrong service throws a
 * TypeError that the click handlers only `console.warn`, so the button looks
 * dead. This test pins the resolution order (uiWorkspace first, workspaces as
 * the legacy fallback) and the loud failure when neither exists — the
 * bundle's "degrade visibly, never a silent no-op" rule.
 *
 * Same zero-DOM harness as injection-test.mjs: stub __ModuleLoader__, import
 * the browser bundle once, drive its pure/host-free helpers through
 * `exports._internal`.
 */

import { strict as assert } from "node:assert";

let loaded = null;
globalThis.window = { __ModuleLoader__: { load(def) { loaded = def; } } };

function requireStub(name) {
	switch (name) {
		case "react": return { useState() {}, useEffect() {}, useRef() {}, useSyncExternalStore() {} };
		case "react/jsx-runtime": return { jsx() {} };
		case "react-dom": return { createPortal() {} };
		case "@deepseek-ai/dsh-client-ui-primitives": return {};
		default: throw new Error("unexpected require: " + name);
	}
}

await import(new URL("../lib/client.js", import.meta.url).href);
assert.ok(loaded, "client bundle registered through __ModuleLoader__");
const internal = loaded.factory(requireStub)._internal;
assert.ok(internal && typeof internal.resolveSessionStarter === "function", "resolveSessionStarter exported via _internal");
assert.ok(typeof internal.openScratchpad === "function", "openScratchpad exported via _internal");
const { resolveSessionStarter, openScratchpad } = internal;

/** A workspaces service whose list already contains the scratchpad id. */
function workspacesWith(workspaceId, extra = {}) {
	return { list: { getSnapshot: () => ({ items: [{ workspaceId }] }) }, ...extra };
}

/** Stub /scratchpad/open. */
function stubFetch(workspaceId) {
	globalThis.fetch = async () => ({ ok: true, json: async () => ({ workspaceId }) });
}

// --- 1. uiWorkspace wins when both capabilities exist -------------------------
{
	const calls = [];
	const uiWorkspace = { startSession: (id) => calls.push(["uiWorkspace", id]) };
	const workspaces = workspacesWith("ws-1", { startSession: (id) => calls.push(["workspaces", id]) });
	const start = resolveSessionStarter(uiWorkspace, workspaces);
	assert.equal(typeof start, "function", "a starter is resolved when uiWorkspace exposes it");
	start("ws-1");
	assert.deepEqual(calls, [["uiWorkspace", "ws-1"]], "uiWorkspace.startSession is preferred");
}

// --- 2. legacy fallback: workspaces.startSession -------------------------------
{
	const calls = [];
	const workspaces = workspacesWith("ws-1", { startSession: (id) => calls.push(["workspaces", id]) });
	const start = resolveSessionStarter(undefined, workspaces);
	assert.equal(typeof start, "function", "legacy workspaces.startSession still resolves");
	start("ws-1");
	assert.deepEqual(calls, [["workspaces", "ws-1"]], "legacy capability used when uiWorkspace is absent");
}

// --- 3. neither capability → null (caller must fail loudly) ---------------------
{
	assert.equal(resolveSessionStarter(undefined, workspacesWith("ws-1")), null, "no uiWorkspace, no legacy startSession → null");
	assert.equal(resolveSessionStarter(null, null), null, "no services at all → null");
}

// --- 4. openScratchpad drives the resolved capability ---------------------------
{
	stubFetch("ws-1");
	const calls = [];
	const uiWorkspace = { startSession: (id) => calls.push(id) };
	await openScratchpad({ workspaces: workspacesWith("ws-1"), uiWorkspace });
	assert.deepEqual(calls, ["ws-1"], "openScratchpad opened the workspace returned by /scratchpad/open");
}

// --- 5. openScratchpad falls back for a legacy harness --------------------------
{
	stubFetch("ws-1");
	const calls = [];
	const workspaces = workspacesWith("ws-1", { startSession: (id) => calls.push(id) });
	await openScratchpad({ workspaces });
	assert.deepEqual(calls, ["ws-1"], "openScratchpad used the legacy capability");
}

// --- 6. no capability → a clear rejection, never a silent no-op ------------------
{
	stubFetch("ws-1");
	let rejected = null;
	try {
		await openScratchpad({ workspaces: workspacesWith("ws-1") });
	} catch (error) {
		rejected = error;
	}
	assert.ok(rejected, "openScratchpad rejects when no startSession capability exists");
	assert.match(String(rejected.message), /startSession/u, "the rejection names the missing capability");
}

// --- 7. malformed host payload still rejects ------------------------------------
{
	globalThis.fetch = async () => ({ ok: true, json: async () => ({}) });
	let rejected = null;
	try {
		await openScratchpad({ workspaces: workspacesWith("ws-1"), uiWorkspace: { startSession() {} } });
	} catch (error) {
		rejected = error;
	}
	assert.match(String(rejected?.message), /bad \/scratchpad\/open payload/u, "missing workspaceId is reported");
}

// --- 8. optional service lookup never turns a missing capability into a boot
//         failure: `uiWorkspace` is absent on older harnesses, and cordis has
//         no optional-inject declaration, so the client half must read it with
//         the framework's optional lookup (`ctx.get`) instead of declaring it.
{
	assert.equal(typeof internal.optionalService, "function", "optionalService exported via _internal");
	const { optionalService } = internal;
	const uiWorkspace = { startSession() {} };
	assert.equal(optionalService({ get: (name) => (name === "uiWorkspace" ? uiWorkspace : undefined) }, "uiWorkspace"), uiWorkspace, "optional lookup returns the provided service");
	assert.equal(optionalService({ get: () => undefined }, "uiWorkspace"), undefined, "optional lookup returns undefined when the harness provides nothing");
	assert.equal(optionalService({ get: () => { throw new Error("cannot get property without inject"); } }, "uiWorkspace"), undefined, "a throwing lookup degrades to undefined");
	assert.equal(optionalService(null, "uiWorkspace"), undefined, "a missing context degrades to undefined");
	assert.equal(optionalService({}, "uiWorkspace"), undefined, "a context without get() degrades to undefined");
}

console.log("open-session-test: starter resolution, optional lookup, fallback, loud failure and payload guard all passed");
