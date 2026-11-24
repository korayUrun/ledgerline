// Full-page screenshots of the running web app, logged in as the seeded demo user.
// Used by the designer subagent (.claude/agents/designer.md) to see the pages it
// changes, and handy by hand.
//
//   pnpm --filter @ledgerline/web screenshot /shows /settings/api-keys
//   WIDTH=390 SCHEME=dark pnpm --filter @ledgerline/web screenshot /shows
//
// Needs `pnpm dev` running and Google Chrome installed. No packages: Chrome is driven
// through its DevTools protocol over Node's built-in WebSocket.
//
// Env: WEB_URL (http://localhost:3000), API_URL (http://localhost:3001), WIDTH (1280),
// SCHEME (light | dark), OUT_DIR (var/screenshots at the repo root), CHROME_PATH.

import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const WEB_URL = process.env.WEB_URL ?? "http://localhost:3000";
const API_URL = process.env.API_URL ?? "http://localhost:3001";
const WIDTH = Number(process.env.WIDTH ?? 1280);
const SCHEME = process.env.SCHEME ?? "light";
const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const OUT_DIR = process.env.OUT_DIR ?? path.join(REPO_ROOT, "var/screenshots");
const CHROME_PATH =
  process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const pagePaths = process.argv.slice(2).filter((arg) => arg !== "--");
if (pagePaths.length === 0) {
  console.error("Give at least one page path, e.g. /shows");
  process.exit(1);
}

// The seeded demo account (packages/db/src/demo-user.ts). Synthetic, local only.
const login = await fetch(`${API_URL}/auth/login`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ email: "demo@ledgerline.test", password: "ledgerline-demo" }),
}).catch(() => null);
if (!login?.ok) {
  console.error(`Could not log in at ${API_URL}. Is \`pnpm dev\` running and the database seeded?`);
  process.exit(1);
}
const { token } = await login.json();

// A throwaway Chrome profile; port 0 lets Chrome pick a free port and write it to
// DevToolsActivePort, so two runs never collide.
const profileDir = await mkdtemp(path.join(tmpdir(), "ledgerline-chrome-"));
const chrome = spawn(
  CHROME_PATH,
  [
    "--headless=new",
    "--remote-debugging-port=0",
    "--no-first-run",
    `--user-data-dir=${profileDir}`,
    "about:blank",
  ],
  { stdio: "ignore" },
);

try {
  const port = await waitForDevToolsPort(profileDir);
  const targets = await fetch(`http://127.0.0.1:${port}/json`).then((r) => r.json());
  const page = targets.find((target) => target.type === "page");
  const cdp = await connect(page.webSocketDebuggerUrl);

  await cdp.send("Page.enable");
  await cdp.send("Network.enable");
  // The same httpOnly cookie the login form sets (apps/web/src/lib/session.ts).
  await cdp.send("Network.setCookie", {
    name: "ledgerline_session",
    value: token,
    url: WEB_URL,
  });
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: WIDTH,
    height: 900,
    deviceScaleFactor: 1,
    mobile: WIDTH < 600,
  });
  await cdp.send("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-color-scheme", value: SCHEME }],
  });

  await mkdir(OUT_DIR, { recursive: true });
  for (const pagePath of pagePaths) {
    const loaded = cdp.waitFor("Page.loadEventFired");
    await cdp.send("Page.navigate", { url: `${WEB_URL}${pagePath}` });
    await loaded;
    // Fonts and client components settle after the load event.
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const { data } = await cdp.send("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: true,
    });
    const name = pagePath.replace(/[^a-z0-9]+/gi, "_").replace(/^_|_$/g, "") || "root";
    const file = path.join(OUT_DIR, `${name}-${WIDTH}-${SCHEME}.png`);
    await writeFile(file, Buffer.from(data, "base64"));
    console.log(file);
  }
  cdp.close();
} finally {
  // kill() only sends the signal; Chrome keeps writing to its profile while it exits,
  // so wait for the exit before deleting the directory.
  const exited = new Promise((resolve) => chrome.once("exit", resolve));
  chrome.kill();
  await exited;
  await rm(profileDir, { recursive: true, force: true, maxRetries: 3 });
}

async function waitForDevToolsPort(dir) {
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      const text = await readFile(path.join(dir, "DevToolsActivePort"), "utf8");
      return Number(text.split("\n")[0]);
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw new Error(`Chrome did not start (CHROME_PATH=${CHROME_PATH})`);
}

// A minimal DevTools protocol client: send() resolves with the result of one command,
// waitFor() with the next event of that name.
async function connect(url) {
  const socket = new WebSocket(url);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  let nextId = 0;
  const pending = new Map();
  const waiting = [];
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.id !== undefined && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(message.error.message));
      else resolve(message.result);
    }
    for (const waiter of waiting.filter((w) => w.method === message.method)) {
      waiting.splice(waiting.indexOf(waiter), 1);
      waiter.resolve(message.params);
    }
  });
  return {
    send(method, params = {}) {
      const id = ++nextId;
      socket.send(JSON.stringify({ id, method, params }));
      return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
    },
    waitFor(method) {
      return new Promise((resolve) => waiting.push({ method, resolve }));
    },
    close() {
      socket.close();
    },
  };
}
