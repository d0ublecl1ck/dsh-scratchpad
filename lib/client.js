/* dsh-scratchpad client half — a hand-written, zero-build browser bundle
 * registered through the public slot system (same pattern as dsh-pulse).
 *
 * Surfaces:
 *  - sidebar.footer.action —— anchor host for the independent 「自由对话」
 *    sidebar section: a display:none anchor inside the footer.action outlet
 *    resolves the sidebar root + regionArea through an explicit per-step
 *    criteria chain (`closest('[data-slot="sidebar.footer.action"]')` →
 *    footerActions → footArea → root, regionArea = footArea's previous
 *    sibling probed for the workspaces outlet), injects a `flex:none` section
 *    div between the new-session button and the workspaces region, and
 *    renders it via `createPortal` (same React tree — locale/context intact).
 *    Any failed criterion degrades VISIBLY to the legacy footer button: the
 *    entry never disappears nor silently mis-inserts.
 *  - conversation.input.dock —— promotion banner (unchanged): polls
 *    /scratchpad/promotions, matches the current sessionId, and offers
 *    "在新工作区打开" (uiWorkspace.startSession(projectWorkspaceId)).
 *
 * No build step: plain JS + react/jsx-runtime + react-dom +
 * dsh-client-ui-primitives.
 */
window.__ModuleLoader__.load({
	id: "@banana-peeljj12/dsh-scratchpad",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		const React = require("react");
		const { useState, useEffect, useRef, useSyncExternalStore } = React;
		const { jsx } = require("react/jsx-runtime");
		const { createPortal } = require("react-dom");
		const primitives = require("@deepseek-ai/dsh-client-ui-primitives");

		/**
		 * Icon names are not stable across harness versions: the primitives package
		 * renamed `IconXxx16` to `IconXxx<Weight><Size>` (IconSparkleMedium /
		 * IconSparkleRegular). Referencing a missing name hands JSX `undefined` as
		 * the element type, React throws #130, and the crash takes the whole slot
		 * entry down with it — the entry simply disappears. Resolve by candidate
		 * list and, failing that, fall back to a bundled inline SVG so a rename
		 * degrades to a plain glyph instead of a dead entry.
		 */
		const ICON_CANDIDATES = {
			newChat: ["IconNewChatOutlineMedium", "IconNewChatOutlineRegular", "IconNewChatOutline16"],
			sparkle: ["IconSparkleMedium", "IconSparkleRegular", "IconSparkle16"],
			folderOpen: ["IconFolderOpenOutlineMedium", "IconFolderOpenOutlineRegular", "IconFolderOpen16"],
			close: ["IconCloseOutlineMedium", "IconCloseOutlineRegular", "IconCloseOutline16"],
		};

		function svgIcon(children) {
			return function FallbackGlyph({ size = 16 } = {}) {
				return jsx("svg", {
					width: size,
					height: size,
					viewBox: "0 0 24 24",
					fill: "none",
					stroke: "currentColor",
					strokeWidth: 2,
					strokeLinecap: "round",
					strokeLinejoin: "round",
					children,
				});
			};
		}

		const FALLBACK_ICONS = {
			newChat: svgIcon(jsx("path", { d: "M4 5h16v11H8l-4 3z" })),
			sparkle: svgIcon(jsx("path", { d: "M12 3l2.2 5.8L20 11l-5.8 2.2L12 19l-2.2-5.8L4 11l5.8-2.2z" })),
			folderOpen: svgIcon(jsx("path", { d: "M3 6h6l2 2h10v10H3z" })),
			close: svgIcon(jsx("path", { d: "M6 6l12 12M18 6L6 18" })),
		};

		/** First defined candidate for `name`, else the bundled inline fallback. */
		function iconOf(primitivesModule, name) {
			const candidates = ICON_CANDIDATES[name] ?? [];
			for (const key of candidates) {
				const candidate = primitivesModule ? primitivesModule[key] : undefined;
				if (candidate !== undefined && candidate !== null) return candidate;
			}
			return FALLBACK_ICONS[name] ?? FALLBACK_ICONS.sparkle;
		}

		// #region style
		const css = `.sp_root{--sp-gap:8px;color:var(--dsw-alias-label-primary);display:flex;flex-direction:column;gap:var(--sp-gap);color-scheme:light}body[data-ds-dark-theme] .sp_root{color-scheme:dark}.sp_footBtn{flex:none;display:inline-flex;align-items:center;gap:8px;height:32px;padding:0 12px;border-radius:8px;border:none;background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 14%,transparent);color:var(--dsw-alias-label-primary);font-size:13px;line-height:20px;cursor:pointer;transition:background .12s ease}.sp_footBtn:hover{background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 24%,transparent)}.sp_footBtnRail{width:32px;padding:0;justify-content:center}.sp_sectionHost{flex:none}.sp_section{display:flex;flex-direction:column;gap:6px;padding:0 0 6px}.sp_sectionHead{padding:0 4px;font-size:12px;line-height:16px;font-weight:600;color:var(--dsw-alias-label-secondary)}.sp_startBtn{width:100%;flex:none;display:inline-flex;align-items:center;justify-content:center;gap:8px;height:32px;padding:0 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 14%,transparent);color:var(--dsw-alias-label-primary);font-size:13px;line-height:20px;cursor:pointer;transition:background .12s ease}.sp_startBtn:hover{background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 24%,transparent)}.sp_sectionRailBtn{flex:none;align-self:center;display:inline-flex;align-items:center;justify-content:center;width:32px;height:32px;padding:0;border:none;border-radius:8px;background:transparent;color:var(--dsw-alias-label-primary);cursor:pointer;transition:background .12s ease}.sp_sectionRailBtn:hover{background:var(--dsw-alias-interactive-bg-hover)}.sp_banner{display:flex;align-items:center;gap:10px;padding:8px 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-base);font-size:13px;line-height:20px}.sp_bannerText{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-secondary)}.sp_bannerTitle{font-weight:600;color:var(--dsw-alias-label-primary)}.sp_bannerBtn{flex:none;border:none;border-radius:8px;padding:4px 10px;background:var(--dsw-interactive-bg-hover);color:var(--dsw-alias-label-primary);font-size:12px;line-height:18px;cursor:pointer}.sp_bannerBtn:hover{background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 20%,transparent)}.sp_pairBtn{width:100%;flex:none;display:inline-flex;align-items:center;justify-content:center;gap:6px;height:38px;padding:0 8px;box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-button-elevated-fill);color:var(--dsw-alias-label-primary);font-size:14px;font-weight:500;line-height:22px;overflow:hidden;cursor:pointer;transition:background .15s ease}.sp_pairBtn:hover{background:var(--dsw-alias-button-floating-hover)}.sp_pairBtn svg{flex:none;width:14px;height:14px}.sp_pairBtn span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.sp_pairHost{flex:none;min-width:0}[data-slot="sidebar"]>div[class*="_root"]:has(>.sp_pairHost){display:grid;grid-template-columns:1fr 1fr;column-gap:8px;align-content:start}[data-slot="sidebar"]>div[class*="_root"]:has(>.sp_pairHost)>*{grid-column:1/-1;min-width:0}[data-slot="sidebar"]>div[class*="_root"]:has(>.sp_pairHost)>button[class*="newSession"]{grid-column:1/2}[data-slot="sidebar"]>div[class*="_root"]:has(>.sp_pairHost)>.sp_pairHost{grid-column:2/3}`;
		const cssTagId = "dsh-scratchpad/scratchpad.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(cssTagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.setAttribute("data-plugin-css", cssTagId);
			tag.textContent = css;
			document.head.append(tag);
		}
		// #endregion

		// #region locale
		const NS = "dsh-scratchpad";
		const zh = {
			open: "自由对话",
			start: "开始自由对话",
			openAria: "新建免工作区自由对话会话",
			openRailTitle: "自由对话",
			promoted: "产物已提升到独立工作区",
			openProject: "在新工作区打开",
			promotionError: "读取提升状态失败",
		};
		const en = {
			open: "Free chat",
			start: "Start a free chat",
			openAria: "New workspace-free chat session",
			openRailTitle: "Free chat",
			promoted: "Artifacts promoted to a project workspace",
			openProject: "Open in project",
			promotionError: "Failed to read promotion state",
		};
		// #endregion

		/** fetch JSON helper (same-origin). */
		function getJson(url) {
			return fetch(url, { method: "GET", headers: { accept: "application/json" } }).then((r) => {
				if (!r.ok) throw new Error("http " + r.status);
				return r.json();
			});
		}

		/**
		 * Bounded-await a workspace inside the client workspaces list after a
		 * host-side create: the list syncs via the workspace-change envelope,
		 * which can lag the `/scratchpad/open` fetch. Poll the list store for
		 * up to `timeoutMs` before giving up.
		 */
		function awaitWorkspaceInList(workspaces, workspaceId, timeoutMs = 3000) {
			const start = Date.now();
			return new Promise((resolve, reject) => {
				const check = () => {
					const items = workspaces.list.getSnapshot().items ?? [];
					if (items.some((item) => item.workspaceId === workspaceId)) return resolve(workspaceId);
					if (Date.now() - start >= timeoutMs) return reject(new Error("workspace " + workspaceId + " not in list within " + timeoutMs + "ms"));
					setTimeout(check, 150);
				};
				check();
			});
		}

		/**
		 * Optional service lookup. `uiWorkspace` is absent on harnesses that
		 * still hang "start a session" off the workspaces controller, and this
		 * cordis build has no optional-`inject` declaration — declaring it would
		 * park the whole plugin (entry and fallback alike) on those harnesses.
		 * `ctx.get` is the framework's documented no-inject-requirement lookup
		 * and returns undefined when nothing provides the service.
		 */
		function optionalService(ctx, name) {
			try {
				if (ctx && typeof ctx.get === "function") {
					const value = ctx.get(name);
					if (value !== undefined && value !== null) return value;
				}
			} catch {
				// Not provided by this harness — fall through to undefined.
			}
			return undefined;
		}

		/**
		 * Resolve the "start a session in this workspace" capability across
		 * harness versions. Current DSH exposes it on `uiWorkspace`; older
		 * builds exposed it on the workspaces controller. Missing on both is
		 * NOT a silent no-op — `null` comes back so the caller can fail loudly.
		 */
		function resolveSessionStarter(uiWorkspace, workspaces) {
			if (uiWorkspace && typeof uiWorkspace.startSession === "function") return (workspaceId) => uiWorkspace.startSession(workspaceId);
			if (workspaces && typeof workspaces.startSession === "function") return (workspaceId) => workspaces.startSession(workspaceId);
			return null;
		}

		/** Open (or reuse) a blank scratchpad session. */
		async function openScratchpad({ workspaces, uiWorkspace }) {
			const start = resolveSessionStarter(uiWorkspace, workspaces);
			if (start === null) throw new Error("no startSession capability: neither uiWorkspace nor workspaces provides it");
			const body = await getJson("/scratchpad/open");
			const workspaceId = body && body.workspaceId;
			if (!workspaceId) throw new Error("bad /scratchpad/open payload");
			await awaitWorkspaceInList(workspaces, workspaceId);
			start(workspaceId);
		}

		// #region injection primitives
		const SECTION_MARK = "data-dsh-plugin-section";
		const SECTION_VALUE = "dsh-scratchpad";
		const OWNER_MARK = "data-dsh-plugin-owner";

		/**
		 * Pure injection-point resolver for the portal section. Walks the
		 * anchor's ancestor chain up to the sidebar root with an explicit
		 * predicate at every step; any failure returns `{ error }` so the
		 * caller degrades visibly instead of mis-inserting. Takes plain
		 * node-shaped objects (nodeType / parentElement / closest /
		 * querySelector), so test/injection-test.mjs can drive it without a
		 * real DOM. The chain relies on the stable `data-slot` attribute of
		 * the slot outlet wrapper (renderSlot renders
		 * `div[data-slot="…"][display:contents]` around every registered
		 * component — the anchor's direct parent is that wrapper, NOT
		 * footerActions; design-review round 1 corrected the off-by-one).
		 */
		function resolveInjectionPoint(anchor) {
			if (!anchor || typeof anchor.closest !== "function") return { error: "anchor is missing" };
			const wrap = anchor.closest('[data-slot="sidebar.footer.action"]');
			if (!wrap || wrap.nodeType !== 1) return { error: "footer.action outlet div not found" };
			const footerActions = wrap.parentElement;
			if (!footerActions || footerActions.nodeType !== 1) return { error: "footerActions div not found" };
			const footArea = footerActions.parentElement;
			if (!footArea || footArea.nodeType !== 1) return { error: "footArea div not found" };
			const root = footArea.parentElement;
			if (!root || root.nodeType !== 1) return { error: "sidebar root not found" };
			const regionArea = footArea.previousElementSibling;
			if (!regionArea || regionArea.nodeType !== 1) return { error: "regionArea sibling not found" };
			const probe = typeof regionArea.querySelector === "function" ? regionArea.querySelector('[data-slot="sidebar.workspaces"]') : null;
			if (!probe) return { error: "regionArea does not own the workspaces outlet" };
			return { root, regionArea };
		}

		/**
		 * Insert the section div right before regionArea (the stable spot
		 * between the new-session button and the workspaces region) and
		 * confirm the container really took it. Returns false on any refusal
		 * so the caller degrades instead of trusting a silent no-op.
		 */
		function insertSectionBefore(root, regionArea, section) {
			try {
				root.insertBefore(section, regionArea);
			} catch (error) {
				return false;
			}
			return typeof root.contains === "function" ? root.contains(section) === true : true;
		}

		/**
		 * Resolve the sidebar root only — the pairing path needs the root and the
		 * workspaces region for the fallback, and reuses the same explicit
		 * per-step chain so a layout change degrades instead of mis-inserting.
		 */
		function resolveSidebarRoot(anchor) {
			const resolved = resolveInjectionPoint(anchor);
			if (resolved.error) return { error: resolved.error };
			return { root: resolved.root, regionArea: resolved.regionArea };
		}

		/**
		 * The shell's new-session button is a direct child of the sidebar root.
		 * Its CSS-module class keeps the `newSession` local name (only the hash
		 * prefix is generated), so match on that instead of the full class name.
		 */
		function isNewSessionButton(node) {
			return Boolean(node) && node.nodeType === 1 && node.tagName === "BUTTON" && String(node.className ?? "").includes("newSession");
		}

		function findNewSessionButton(root) {
			if (!root || !root.children) return null;
			for (const child of root.children) if (isNewSessionButton(child)) return child;
			return null;
		}

		/**
		 * Place the portal host. Wide sidebar with a locatable new-session button:
		 * sit right after it, where CSS puts the two side by side. Otherwise fall
		 * back to the full-width slot above the workspaces region, and report
		 * `failed` when even that is refused, so the caller can render the footer
		 * button instead of a dead entry.
		 */
		function placeEntry(root, host, regionArea, wide) {
			const newSession = wide ? findNewSessionButton(root) : null;
			if (newSession !== null && typeof root.insertBefore === "function") {
				root.insertBefore(host, newSession.nextElementSibling ?? null);
				return "paired";
			}
			if (insertSectionBefore(root, regionArea, host)) return "section";
			return "failed";
		}
		// #endregion

		/** Sidebar footer action — kept only as the visible degrade fallback. */
		function ScratchpadFooterAction({ wide, t, workspaces, uiWorkspace }) {
			return jsx("button", {
				type: "button",
				className: "sp_footBtn" + (wide ? "" : " sp_footBtnRail"),
				onClick: () => {
					openScratchpad({ workspaces, uiWorkspace }).catch((error) => {
						console.warn("dsh-scratchpad: open failed", error);
					});
				},
				"aria-label": t("openAria"),
				title: wide ? t("open") : t("openRailTitle"),
				children: wide
					? [jsx(iconOf(primitives, "newChat"), { key: "i", size: 16 }), jsx("span", { key: "l", children: t("open") })]
					: jsx(iconOf(primitives, "newChat"), { size: 16 }),
			});
		}

		/**
		 * The portal content of the injected entry:
		 *  - paired: one button beside the shell's new-session button, the layout
		 *    on an expanded sidebar;
		 *  - rail (56px): a single icon button, deliberately distinct from the
		 *    shell new-session icon next to it;
		 *  - section: the full-width fallback when the new-session button cannot
		 *    be located, so the entry never disappears.
		 */
		function ScratchpadSection({ wide, paired, t, workspaces, uiWorkspace }) {
			const open = () => {
				openScratchpad({ workspaces, uiWorkspace }).catch((error) => {
					console.warn("dsh-scratchpad: open failed", error);
				});
			};
			if (paired) {
				return jsx("button", {
					type: "button",
					className: "sp_pairBtn",
					onClick: open,
					"aria-label": t("openAria"),
					title: t("open"),
					children: [jsx(iconOf(primitives, "sparkle"), { key: "i", size: 14 }), jsx("span", { key: "l", children: t("open") })],
				});
			}
			if (!wide) {
				return jsx("button", {
					type: "button",
					className: "sp_sectionRailBtn",
					onClick: open,
					"aria-label": t("openAria"),
					title: t("openRailTitle"),
					children: jsx(iconOf(primitives, "sparkle"), { size: 16 }),
				});
			}
			return jsx("div", { className: "sp_section", children: [
				jsx("div", { key: "head", className: "sp_sectionHead", children: t("open") }),
				jsx("button", {
					key: "start",
					type: "button",
					className: "sp_startBtn",
					onClick: open,
					"aria-label": t("openAria"),
					children: [jsx(iconOf(primitives, "sparkle"), { key: "i", size: 16 }), jsx("span", { key: "l", children: t("start") })],
				}),
			] });
		}

		/**
		 * Registered into sidebar.footer.action: normally an invisible anchor
		 * that mounts the portal section into the sidebar root; on any
		 * injection failure the legacy footer button renders instead, so the
		 * entry never disappears. The injected div carries the section mark
		 * (idempotent reuse across double-apply/HMR) plus an owner token —
		 * cleanup only removes the node while its owner token still matches,
		 * so an adopted node survives its previous owner's unmount.
		 */
		function ScratchpadSectionHost({ wide, t, workspaces, uiWorkspace }) {
			const anchorRef = useRef(null);
			const [entry, setEntry] = useState({ node: null, mode: "section" });
			const [failed, setFailed] = useState(false);

			useEffect(() => {
				const anchor = anchorRef.current;
				if (!anchor) return undefined;
				const token = "owner-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2);
				let section = document.querySelector("[" + SECTION_MARK + '="' + SECTION_VALUE + '"]');
				if (!section) {
					section = document.createElement("div");
					section.setAttribute(SECTION_MARK, SECTION_VALUE);
				}
				// Adopt an existing node and rewrite the owner token: a still
				// running previous instance then fails the token check on its
				// cleanup and leaves the entry alone.
				section.setAttribute(OWNER_MARK, token);
				const resolved = resolveSidebarRoot(anchor);
				if (resolved.error) {
					console.warn("dsh-scratchpad: sidebar not found, falling back to footer button:", resolved.error);
					section.remove();
					setFailed(true);
					return undefined;
				}
				const mode = placeEntry(resolved.root, section, resolved.regionArea, wide);
				if (mode === "failed") {
					console.warn("dsh-scratchpad: entry insert refused, falling back to footer button");
					section.remove();
					setFailed(true);
					return undefined;
				}
				// The pairing rule keys off this class, so set it in the same task
				// as the insert — no frame paints the entry unpaired.
				section.className = mode === "paired" ? "sp_pairHost" : "sp_sectionHost";
				setFailed(false);
				setEntry({ node: section, mode });
				return () => {
					if (section.getAttribute(OWNER_MARK) === token) section.remove();
				};
			}, [wide]);

			return jsx(React.Fragment, { children: [
				jsx("span", { key: "anchor", ref: anchorRef, style: { display: "none" } }),
				entry.node ? createPortal(jsx(ScratchpadSection, { wide, paired: entry.mode === "paired", t, workspaces, uiWorkspace }), entry.node) : null,
				failed ? jsx(ScratchpadFooterAction, { key: "fallback", wide, t, workspaces, uiWorkspace }) : null,
			] });
		}

		/**
		 * conversation.input.dock — promotion banner for the current session.
		 * Polls /scratchpad/promotions when the session is blank or after a
		 * tool activity; hides once dismissed or the session leaves the list.
		 */
		function PromotionBanner(props) {
			const { sessionId, t } = props;
			const workspaces = props.workspaces;
			const uiWorkspace = props.uiWorkspace;
			const [record, setRecord] = useState(null);
			const [dismissed, setDismissed] = useState(false);
			const [error, setError] = useState(false);
			const pollRef = useRef(null);

			useEffect(() => {
				if (!sessionId) return undefined;
				setRecord(null);
				setDismissed(false);
				setError(false);
				let alive = true;
				const poll = () => {
					getJson("/scratchpad/promotions").then((body) => {
						if (!alive) return;
						const rows = body && Array.isArray(body.promotions) ? body.promotions : [];
						const match = rows.find((row) => row.sessionId === sessionId) || null;
						setRecord(match);
						setError(false);
					}).catch(() => {
						if (alive) setError(true);
					});
				};
				poll();
				pollRef.current = setInterval(poll, 4000);
				return () => {
					alive = false;
					if (pollRef.current !== null) clearInterval(pollRef.current);
				};
			}, [sessionId]);

			if (!record || dismissed || error) {
				return error
					? jsx("div", { className: "sp_banner", children: jsx("span", { className: "sp_bannerText", children: t("promotionError") }) })
					: null;
			}
			return jsx("div", { className: "sp_banner", children: [
				jsx(iconOf(primitives, "folderOpen"), { key: "i", size: 16 }),
				jsx("span", { key: "text", className: "sp_bannerText", children: [t("promoted"), " ", jsx("span", { className: "sp_bannerTitle", children: record.title })] }),
				jsx("button", {
					key: "open",
					type: "button",
					className: "sp_bannerBtn",
					onClick: () => {
						setDismissed(true);
						// The workspace-list sync envelope can lag the promotion record
						// (the record comes from our own route poll, the list from the
						// host/workspace-changed envelope); startSession throws on a
						// not-yet-synced workspace, so bound-await it in the list first.
						const start = resolveSessionStarter(uiWorkspace, workspaces);
						if (start === null) {
							console.warn("dsh-scratchpad: no startSession capability for the promoted workspace");
							return;
						}
						awaitWorkspaceInList(workspaces, record.workspaceId).then(() => {
							start(record.workspaceId);
						}, (error) => {
							console.warn("dsh-scratchpad: promoted workspace not in list", error);
						});
					},
					children: t("openProject"),
				}),
				jsx("button", {
					key: "close",
					type: "button",
					className: "sp_bannerBtn",
					"aria-label": "dismiss",
					onClick: () => setDismissed(true),
					children: jsx(iconOf(primitives, "close"), { size: 14 }),
				}),
			] });
		}

		// #region plugin
		/** Required services (cordis fiber inject). */
		const inject = ["slots", "locale", "workspaces"];

		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, { zh, en }), "dsh-scratchpad: copy dictionaries");
			const t = ctx.locale.bind(NS);
			ctx.slots.inject("sidebar.footer.action", () => ctx.slots.register({
				name: "sidebar.footer.action",
				id: "dsh-scratchpad",
				order: 3,
				label: () => t("open"),
				inject: () => ({ t, workspaces: ctx.workspaces, uiWorkspace: optionalService(ctx, "uiWorkspace") }),
			}, ScratchpadSectionHost));
			ctx.slots.inject("conversation.input.dock", () => ctx.slots.register({
				name: "conversation.input.dock",
				id: "dsh-scratchpad:promotion",
				order: 5,
				label: () => t("open"),
				// `conversation.input.dock` is a SESSION-scoped slot: the registry
				// calls the inject face with the owning sessionId as the first
				// argument (same pattern as the in-repo queue dock), so the banner
				// can match its polled promotion record to the current session.
				inject: (sessionId) => ({ sessionId, t, workspaces: ctx.workspaces, uiWorkspace: optionalService(ctx, "uiWorkspace") }),
			}, PromotionBanner));
		}
		// #endregion

		exports.apply = apply;
		exports.inject = inject;
		// Test-only surface: pure locators without DOM side effects.
		exports._internal = { resolveInjectionPoint, insertSectionBefore, resolveSidebarRoot, findNewSessionButton, isNewSessionButton, placeEntry, resolveSessionStarter, openScratchpad, optionalService, iconOf };
		return module.exports;
	},
});
