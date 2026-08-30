/* dsh-scratchpad client half — a hand-written, zero-build browser bundle
 * registered through the public slot system (same pattern as dsh-pulse).
 *
 * Surfaces:
 *  - sidebar.footer.action  —— 「自由对话」 button: GET /scratchpad/open for the
 *    scratchpad workspaceId, bounded-await it in the workspaces list (the
 *    workspace-list sync envelope can lag the fetch), then
 *    workspaces.startSession(workspaceId) to open a blank session there.
 *  - conversation.input.dock —— promotion banner: polls /scratchpad/promotions,
 *    matches the current sessionId, and offers "在新工作区打开"
 *    (workspaces.startSession(projectWorkspaceId)).
 *
 * No build step: plain JS + react/jsx-runtime + dsh-client-ui-primitives.
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
		const primitives = require("@deepseek-ai/dsh-client-ui-primitives");

		// #region style
		const css = `.sp_root{--sp-gap:8px;color:var(--dsw-alias-label-primary);display:flex;flex-direction:column;gap:var(--sp-gap);color-scheme:light}body[data-ds-dark-theme] .sp_root{color-scheme:dark}.sp_footBtn{flex:none;display:inline-flex;align-items:center;gap:8px;height:32px;padding:0 12px;border-radius:8px;border:none;background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 14%,transparent);color:var(--dsw-alias-label-primary);font-size:13px;line-height:20px;cursor:pointer;transition:background .12s ease}.sp_footBtn:hover{background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 24%,transparent)}.sp_footBtnRail{width:32px;padding:0;justify-content:center}.sp_banner{display:flex;align-items:center;gap:10px;padding:8px 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-base);font-size:13px;line-height:20px}.sp_bannerText{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-secondary)}.sp_bannerTitle{font-weight:600;color:var(--dsw-alias-label-primary)}.sp_bannerBtn{flex:none;border:none;border-radius:8px;padding:4px 10px;background:var(--dsw-interactive-bg-hover);color:var(--dsw-alias-label-primary);font-size:12px;line-height:18px;cursor:pointer}.sp_bannerBtn:hover{background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 20%,transparent)}`;
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
			openAria: "新建免工作区自由对话会话",
			openRailTitle: "自由对话",
			promoted: "产物已提升到独立工作区",
			openProject: "在新工作区打开",
			promotionError: "读取提升状态失败",
		};
		const en = {
			open: "Free chat",
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

		/** Open (or reuse) a blank scratchpad session. */
		async function openScratchpad(workspaces) {
			const body = await getJson("/scratchpad/open");
			const workspaceId = body && body.workspaceId;
			if (!workspaceId) throw new Error("bad /scratchpad/open payload");
			await awaitWorkspaceInList(workspaces, workspaceId);
			workspaces.startSession(workspaceId);
		}

		/** sidebar.footer.action - the persistent free-chat entry. */
		function ScratchpadFooterAction({ wide, t, workspaces }) {
			return jsx("button", {
				type: "button",
				className: "sp_footBtn" + (wide ? "" : " sp_footBtnRail"),
				onClick: () => {
					openScratchpad(workspaces).catch((error) => {
						console.warn("dsh-scratchpad: open failed", error);
					});
				},
				"aria-label": t("openAria"),
				title: wide ? t("open") : t("openRailTitle"),
				children: wide
					? [jsx(primitives.IconNewChatOutline16, { key: "i", size: 16 }), jsx("span", { key: "l", children: t("open") })]
					: jsx(primitives.IconNewChatOutline16, { size: 16 }),
			});
		}

		/**
		 * conversation.input.dock — promotion banner for the current session.
		 * Polls /scratchpad/promotions when the session is blank or after a
		 * tool activity; hides once dismissed or the session leaves the list.
		 */
		function PromotionBanner(props) {
			const { sessionId, t } = props;
			const workspaces = props.workspaces;
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
				jsx(primitives.IconFolderOpen16, { key: "i", size: 16 }),
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
						awaitWorkspaceInList(workspaces, record.workspaceId).then(() => {
							workspaces.startSession(record.workspaceId);
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
					children: jsx(primitives.IconCloseOutline16, { size: 14 }),
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
				inject: () => ({ t, workspaces: ctx.workspaces }),
			}, ScratchpadFooterAction));
			ctx.slots.inject("conversation.input.dock", () => ctx.slots.register({
				name: "conversation.input.dock",
				id: "dsh-scratchpad:promotion",
				order: 5,
				label: () => t("open"),
				// `conversation.input.dock` is a SESSION-scoped slot: the registry
				// calls the inject face with the owning sessionId as the first
				// argument (same pattern as the in-repo queue dock), so the banner
				// can match its polled promotion record to the current session.
				inject: (sessionId) => ({ sessionId, t, workspaces: ctx.workspaces }),
			}, PromotionBanner));
		}
		// #endregion

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	},
});