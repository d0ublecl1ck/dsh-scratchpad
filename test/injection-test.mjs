/**
 * Client-half injection test: drives the pure locators of lib/client.js
 * (resolveInjectionPoint / insertSectionBefore) with node-shaped mock
 * objects — no real DOM needed. Covers the healthy closest()-based
 * three-level chain and every explicit degrade criterion (outlet wrap
 * missing, hierarchy broken, regionArea not owning the workspaces outlet,
 * refused insert / failed containment), matching the design rule
 * "degrade visibly, never mis-insert".
 *
 * The client bundle is a zero-build browser script; to evaluate it under
 * Node we stub `window.__ModuleLoader__`, import the file once, then call
 * its factory with a stubbed require so the pure functions are reachable
 * through `exports._internal`.
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
assert.ok(internal && typeof internal.resolveInjectionPoint === "function", "resolveInjectionPoint exported via _internal");
assert.ok(typeof internal.insertSectionBefore === "function", "insertSectionBefore exported via _internal");
const { resolveInjectionPoint, insertSectionBefore } = internal;

// --- mock DOM: node-shaped objects matching the resolver contract ------------

function slotOf(sel) {
	const m = /\[data-slot="([^"]+)"\]/u.exec(sel);
	return m ? m[1] : null;
}

function mkNode(tag, { attrs = {}, parent = null } = {}) {
	return {
		nodeType: 1,
		tagName: tag,
		attrs,
		parentElement: parent,
		closest(sel) {
			const key = slotOf(sel);
			if (key === null) throw new Error("mock closest only supports [data-slot=\"…\"] selectors");
			for (let n = this; n; n = n.parentElement) {
				if (n.attrs && n.attrs["data-slot"] === key) return n;
			}
			return null;
		},
	};
}

/**
 * Healthy sidebar shape:
 *   root( flex column )
 *    ├─ regionArea  [ div[data-slot="sidebar.workspaces"] ]
 *    └─ footArea
 *        └─ footerActions
 *            └─ div[data-slot="sidebar.footer.action"]   (SlotOutlet wrap)
 *                └─ anchor (plugin host component root)
 */
function buildHealthy({ regionProbeHit = true, sibling = true } = {}) {
	const root = mkNode("div");
	const regionWrap = mkNode("div", { attrs: { "data-slot": "sidebar.workspaces" } });
	const regionArea = mkNode("div", { parent: root });
	regionArea.querySelector = (sel) => (regionProbeHit && slotOf(sel) === "sidebar.workspaces" ? regionWrap : null);
	const footerActions = mkNode("div");
	const footArea = mkNode("div", { parent: footerActions.parentElement === root ? root : root });
	footArea.parentElement = root;
	footArea.previousElementSibling = sibling ? regionArea : null;
	const outlet = mkNode("div", { attrs: { "data-slot": "sidebar.footer.action" }, parent: footerActions });
	footerActions.parentElement = footArea;
	const anchor = mkNode("span", { parent: outlet });
	// insertion bookkeeping for insertSectionBefore cases
	root.children = [regionArea, footArea];
	root.insertBefore = (node, ref) => {
		const idx = root.children.indexOf(ref);
		if (idx < 0) throw new Error("reference node is not a child");
		root.children.splice(idx, 0, node);
		return node;
	};
	root.contains = (node) => root.children.includes(node);
	return { root, regionArea, footArea, footerActions, outlet, anchor };
}

// --- 1. healthy chain resolves root + regionArea ------------------------------
{
	const t = buildHealthy();
	const got = resolveInjectionPoint(t.anchor);
	assert.equal(got.error, undefined, "healthy chain resolves without error");
	assert.equal(got.root, t.root, "root is the sidebar root");
	assert.equal(got.regionArea, t.regionArea, "regionArea is the sibling above footArea");
}

// --- 2. outlet wrap missing → explicit degrade ---------------------------------
{
	const anchor = mkNode("span"); // no [data-slot] ancestor at all
	const got = resolveInjectionPoint(anchor);
	assert.equal(got.root, undefined, "no result on failure");
	assert.match(got.error, /outlet div not found/u);
}

// --- 3. hierarchy broken → explicit degrade ------------------------------------
{
	const t = buildHealthy();
	t.footerActions.parentElement = null; // footerActions no longer under footArea
	const got = resolveInjectionPoint(t.anchor);
	assert.match(got.error, /footArea div not found/u);
}
{
	const t = buildHealthy();
	t.footArea.parentElement = null; // footArea detached from the sidebar root
	const got = resolveInjectionPoint(t.anchor);
	assert.match(got.error, /sidebar root not found/u);
}

// --- 4. regionArea sibling missing → explicit degrade ---------------------------
{
	const t = buildHealthy({ sibling: false });
	const got = resolveInjectionPoint(t.anchor);
	assert.match(got.error, /regionArea sibling not found/u);
}

// --- 5. regionArea not owning the workspaces outlet → explicit degrade ---------
{
	const t = buildHealthy({ regionProbeHit: false });
	const got = resolveInjectionPoint(t.anchor);
	assert.match(got.error, /does not own the workspaces outlet/u);
}

// --- 6. insertSectionBefore: lands right before regionArea ----------------------
{
	const t = buildHealthy();
	const section = mkNode("div");
	assert.equal(insertSectionBefore(t.root, t.regionArea, section), true, "insert succeeds");
	assert.equal(t.root.children.indexOf(section), 0, "section sits before regionArea");
	assert.equal(t.root.children[1], t.regionArea, "regionArea still present");
	assert.equal(t.root.children[2], t.footArea, "footArea untouched");
}

// --- 7. insertSectionBefore: refused insert degrades ----------------------------
{
	const t = buildHealthy();
	const section = mkNode("div");
	const stranger = mkNode("div"); // not a child of root → insertBefore throws
	assert.equal(insertSectionBefore(t.root, stranger, section), false, "throwing insert degrades to false");
	assert.equal(t.root.children.includes(section), false, "nothing was inserted");
}

// --- 8. insertSectionBefore: containment failure degrades -----------------------
{
	const t = buildHealthy();
	const section = mkNode("div");
	t.root.contains = () => false; // simulate a container that silently dropped the node
	assert.equal(insertSectionBefore(t.root, t.regionArea, section), false, "failed containment check degrades to false");
}

// --- 9. edge cases: missing anchor, missing closest, non-element nodes ----------
{
	assert.match(resolveInjectionPoint(null).error, /anchor is missing/u);
	assert.match(resolveInjectionPoint({}).error, /anchor is missing/u);
	const t = buildHealthy();
	t.outlet.nodeType = 3; // text node
	assert.match(resolveInjectionPoint(t.anchor).error, /outlet div not found/u);
	const t2 = buildHealthy();
	delete t2.root.contains; // fallback to true when contains is not a function
	const section = mkNode("div");
	assert.equal(insertSectionBefore(t2.root, t2.regionArea, section), true, "contains missing falls back to true");
}

console.log("injection-test: locate chain, per-step criteria and insert guards all passed");
