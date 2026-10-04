/**
 * Headless render check for the sidebar entry.
 *
 * Prerequisites
 *   - a running DSH web/desktop instance (`dsh web`, or the desktop app)
 *   - `DSH_HOME` pointing at that instance's home (its `.credentials.yaml` is
 *     read to mint a browser session cookie)
 *   - Google Chrome (or pass --chrome <path>)
 *
 * Usage
 *   DSH_HOME=~/.dsh node scripts/verify-render.mjs
 *   DSH_HOME="$HOME/Library/Application Support/dsh-desktop/harness" \
 *     node scripts/verify-render.mjs --host 127.0.0.1:43129
 *
 * What it checks (exits non-zero on the first failure)
 *   1. the sidebar root resolves and the plugin host node sits directly after
 *      the shell's new-session button (the paired layout), or, when the shell
 *      button cannot be located, that the fallback section is present
 *   2. the entry renders a button and the new-session button shares its row
 *   3. the console shows no `slot entry crashed` / React #130
 *
 * Side effects: launches headless Chrome under a temp user-data-dir and removes
 * it on exit. It never writes to the running instance.
 */

import { readFileSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { createHash, createHmac } from "node:crypto";
import { spawn } from "node:child_process";

const args = process.argv.slice(2);
const valueOf = (flag, fallback) => {
  const i = args.indexOf(flag);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const authority = valueOf("--host", "127.0.0.1:3080");
const home = process.env.DSH_HOME || join(homedir(), ".dsh");
const chromePath = valueOf("--chrome", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome");
const port = Number(valueOf("--cdp-port", "9377"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const b64url = (v) => Buffer.from(v).toString("base64").replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
const yaml = readFileSync(join(home, ".credentials.yaml"), "utf8");
const secretMatch = yaml.match(/client-connection\/browser-session:[\s\S]*?\n\s+secret:\s*([A-Za-z0-9_-]+)/u);
if (!secretMatch) throw new Error("no client-connection/browser-session secret in " + join(home, ".credentials.yaml"));
const secret = Buffer.from(secretMatch[1].replaceAll("-", "+").replaceAll("_", "/"), "base64");
const issuedAt = Date.now();
const payload = { version: 1, authority, issuedAt, expiresAt: issuedAt + 5 * 60 * 1000 };
const body = b64url(Buffer.from(JSON.stringify(payload), "utf8"));
const cookieName = "dsh-auth-" + b64url(createHash("sha256").update(authority).digest());
const cookieValue = "v1." + body + "." + b64url(createHmac("sha256", secret).update(body).digest());

const profileDir = join(tmpdir(), "dsh-render-check-" + Date.now());
const chrome = spawn(chromePath, [
  "--headless=new", "--remote-debugging-port=" + port, "--user-data-dir=" + profileDir,
  "--no-first-run", "--no-default-browser-check", "--disable-gpu", "--window-size=1440,900", "about:blank",
], { stdio: "ignore" });

const fail = (message) => {
  console.error("FAIL: " + message);
  try { chrome.kill(); } catch {}
  try { rmSync(profileDir, { recursive: true, force: true }); } catch {}
  process.exit(1);
};

let wsUrl = null;
for (let i = 0; i < 40 && !wsUrl; i += 1) {
  await sleep(500);
  try {
    const list = await (await fetch("http://127.0.0.1:" + port + "/json/list")).json();
    wsUrl = list.find((t) => t.type === "page")?.webSocketDebuggerUrl ?? null;
  } catch { /* chrome still starting */ }
}
if (!wsUrl) fail("headless Chrome did not expose CDP on port " + port);

const ws = new WebSocket(wsUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0;
const pending = new Map();
const crashes = [];
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); return; }
  if (msg.method === "Runtime.consoleAPICalled") {
    const text = (msg.params.args || []).map((a) => a.value ?? a.description ?? "").join(" ");
    if (/slot entry crashed|React error #130/.test(text)) crashes.push(text.slice(0, 200));
  }
};
const send = (method, params = {}) => new Promise((res) => { const n = ++id; pending.set(n, res); ws.send(JSON.stringify({ id: n, method, params })); });

await send("Runtime.enable");
await send("Page.enable");
await send("Network.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
await send("Network.setCookie", { name: cookieName, value: cookieValue, domain: authority.split(":")[0], path: "/" });
await send("Page.navigate", { url: "http://" + authority + "/" });
await sleep(15000);

const probe = await send("Runtime.evaluate", {
  expression: `JSON.stringify((() => {
    const root = document.querySelector('[data-slot="sidebar"] > div[class*="_root"]');
    const host = root ? root.querySelector(':scope > [data-dsh-plugin-section="dsh-scratchpad"]') : null;
    const shellBtn = root ? root.querySelector(':scope > button[class*="newSession"]') : null;
    const entryBtn = host ? host.querySelector('.sp_pairBtn, .sp_sectionRailBtn, .sp_startBtn') : null;
    const rect = (el) => el ? el.getBoundingClientRect() : null;
    const a = rect(shellBtn), b = rect(entryBtn);
    return {
      hostFound: Boolean(host),
      hostClass: host ? host.className : null,
      entryLabel: entryBtn ? entryBtn.textContent.trim() : null,
      paired: host ? host.classList.contains('sp_pairHost') : false,
      sameRow: a && b ? Math.abs(a.y - b.y) < 2 : null,
      flexWidth: a && b ? Math.abs(a.width - b.width) / Math.max(a.width, 1) < 0.25 : null,
    };
  })())`,
  returnByValue: true,
});
const result = JSON.parse(probe.result?.result?.value ?? "{}");
ws.close();
chrome.kill();
try { rmSync(profileDir, { recursive: true, force: true }); } catch {}

const checks = [
  ["host node injected", result.hostFound === true],
  ["entry button rendered", Boolean(result.entryLabel)],
  ["paired with the shell new-session button", result.paired === true],
  ["same row as the shell button", result.sameRow === true],
  ["roughly equal widths", result.flexWidth === true],
  ["no crashed slot entry", crashes.length === 0],
];
for (const [name, ok] of checks) console.log((ok ? "PASS" : "FAIL") + " - " + name);
console.log("entry label: " + result.entryLabel + " | host class: " + result.hostClass);
if (crashes.length) console.log("console: " + crashes.join(" | "));
const failed = checks.filter(([, ok]) => !ok).map(([name]) => name);
if (failed.length) fail(failed.join(", "));
console.log("verify-render: all checks passed");