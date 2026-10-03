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

// --- 9. icon resolution across harness versions --------------------------------
// The primitives package renamed IconXxx16 → IconXxx<Weight><Size>
// (IconSparkleMedium / IconSparkleRegular). The entry used to reference the old
// names directly, so a rename made every JSX element type `undefined` and React
// error #130 crashed the whole sidebar slot — the entry vanished. Resolution
// must never return undefined: fall back to a bundled inline SVG instead.
{
	assert.equal(typeof internal.iconOf, "function", "iconOf exported via _internal");
	const { iconOf } = internal;
	const New = () => null;
	const Legacy = () => null;
	assert.equal(iconOf({ IconSparkleMedium: New, IconSparkle16: Legacy }, "sparkle"), New, "current naming wins when both exist");
	assert.equal(iconOf({ IconSparkle16: Legacy }, "sparkle"), Legacy, "legacy naming still resolves");
	for (const name of ["newChat", "sparkle", "folderOpen", "close"]) {
		assert.equal(typeof iconOf({}, name), "function", name + " falls back to a component, never undefined");
		assert.equal(typeof iconOf(undefined, name), "function", name + " resolves without a primitives module");
	}
	assert.equal(typeof iconOf({}, "not-a-real-icon"), "function", "an unknown icon name still yields a component");
}

// --- 10. entry placement: pair with the shell's new-session button --------------
// The entry belongs beside the shell new-session button (two 50% buttons) on an
// expanded sidebar instead of a full-width block above the workspace list. The
// shell button is React-owned, so the entry moves itself into the slot right
// after it and the pairing is expressed in CSS (`:has(> .sp_pairHost)`), never
// by reparenting a React-managed node.
{
	for (const name of ["findNewSessionButton", "isNewSessionButton", "placeEntry"]) {
		assert.equal(typeof internal[name], "function", name + " exported via _internal");
	}
	const { findNewSessionButton, isNewSessionButton, placeEntry } = internal;
	const mkNode = (tag, className) => ({ nodeType: 1, tagName: tag, className });
	function mockRoot(children) {
		// Sibling links derive from the live child array: placement inserts
		// relative to the new-session button's next sibling, so a mock without
		// them would silently append at the end instead of pairing.
		for (const child of children) {
			for (const prop of ["nextSibling", "nextElementSibling"]) {
				Object.defineProperty(child, prop, {
					configurable: true,
					get() {
						const at = children.indexOf(this);
						return at < 0 || at === children.length - 1 ? null : children[at + 1];
					},
				});
			}
		}
		return {
			children,
			insertBefore(node, ref) {
				const at = ref === null || ref === undefined ? children.length : children.indexOf(ref);
				if (at < 0) throw new Error("reference node is not a child");
				children.splice(at, 0, node);
				return node;
			},
			contains: (node) => children.includes(node),
		};
	}
	const newSession = mkNode("BUTTON", "hHd-Xa_newSession");
	const brand = mkNode("BUTTON", "hHd-Xa_brand hHd-Xa_wide");
	assert.equal(isNewSessionButton(newSession), true, "CSS-module hash prefix does not hide the newSession local name");
	assert.equal(isNewSessionButton(brand), false, "the brand button is not the new-session button");
	assert.equal(isNewSessionButton(null), false, "a missing node is not the new-session button");

	// paired: the entry lands immediately after the shell button
	{
		const region = mkNode("DIV", "regionArea");
		const root = mockRoot([mkNode("DIV", "logoRow"), newSession, mkNode("NAV", "panelList"), region]);
		const host = mkNode("DIV", "sp_pairHost");
		assert.equal(placeEntry(root, host, region, true), "paired", "wide sidebar pairs the entry");
		assert.equal(root.children.indexOf(host), root.children.indexOf(newSession) + 1, "entry sits right after the new-session button");
		assert.equal(findNewSessionButton(root), newSession, "new-session button is found among direct children");
	}
	// rail: no pairing, the previous slot above the workspaces region
	{
		const region = mkNode("DIV", "regionArea");
		const root = mockRoot([mkNode("DIV", "logoRow"), newSession, region]);
		const host = mkNode("DIV", "sp_sectionHost");
		assert.equal(placeEntry(root, host, region, false), "section", "collapsed sidebar keeps the full-width slot");
		assert.equal(root.children.indexOf(host), root.children.indexOf(region) - 1, "entry inserted before the workspaces region");
	}
	// a shell without the new-session button degrades to the section slot
	{
		const region = mkNode("DIV", "regionArea");
		const root = mockRoot([mkNode("DIV", "logoRow"), region]);
		const host = mkNode("DIV", "sp_sectionHost");
		assert.equal(placeEntry(root, host, region, true), "section", "missing new-session button degrades to the section");
	}
	// a container that refuses the insert reports failure instead of pretending
	{
		const region = mkNode("DIV", "regionArea");
		const stranger = mkNode("DIV", "notAChild");
		const root = mockRoot([mkNode("DIV", "logoRow"), region]);
		const host = mkNode("DIV", "sp_sectionHost");
		assert.equal(placeEntry(root, host, stranger, false), "failed", "refused insert reports failure");
	}
}

console.log("open-session-test: starter, optional lookup, icons, placement, fallback, loud failure and payload guard all passed");
