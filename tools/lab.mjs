// The lab of the bookkeeper skill (.claude/skills/bookkeeper/references/lab.md). Nothing here touches D:\ANNATERIA.
//
//   node tools/lab.mjs serve     the page on http://127.0.0.1:8000 and the local Worker on http://127.0.0.1:8787
//   node tools/lab.mjs page      the page only (the Worker runs elsewhere)
//   node tools/lab.mjs restore   D:\ANNATERIA-LAB\work, drive and usb start again from clean
//   node tools/lab.mjs status    what the lab holds
//
// The page is served with no-store, because the embedded browser caches modules otherwise, and with a replaced config.js, so the
// repository's file stays pointed at the real Worker.
import { spawn, spawnSync } from "node:child_process";
import { cpSync, createReadStream, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const LAB = process.env.ANNATERIA_LAB || "D:\\ANNATERIA-LAB";
const REPOSITORY = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const WEB = join(REPOSITORY, "web");
const WORKER = join(REPOSITORY, "worker");
const PAGE_PORT = Number(process.env.LAB_PAGE_PORT || 8000);
const WORKER_PORT = Number(process.env.LAB_WORKER_PORT || 8787);

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".wasm": "application/wasm",
  ".webmanifest": "application/manifest+json",
};

function buildMarker() {
  const git = (...args) => spawnSync("git", args, { cwd: REPOSITORY, encoding: "utf8" }).stdout.trim();
  return `lab ${git("rev-parse", "--short", "HEAD")}${git("status", "--short", "web") ? " + changes" : ""}`;
}

function servePage() {
  const config = `window.ANNATERIA_API = "http://127.0.0.1:${WORKER_PORT}";\n`;
  const server = createServer((request, response) => {
    const path = decodeURIComponent(new URL(request.url, "http://lab").pathname);
    const headers = { "Cache-Control": "no-store" };
    if (path === "/config.js") {
      response.writeHead(200, { ...headers, "Content-Type": TYPES[".js"] });
      response.end(config);
      return;
    }
    if (path === "/" || path === "/index.html") {
      // The published page gets its build marker from the deploy workflow. The lab's says which commit it runs, and whether files differ.
      response.writeHead(200, { ...headers, "Content-Type": TYPES[".html"] });
      response.end(readFileSync(join(WEB, "index.html"), "utf8").replace("BUILD_ID", buildMarker()));
      return;
    }
    const file = normalize(join(WEB, path));
    if (!file.startsWith(WEB + sep) || !existsSync(file) || !statSync(file).isFile()) {
      response.writeHead(404, headers);
      response.end("Not found");
      return;
    }
    response.writeHead(200, { ...headers, "Content-Type": TYPES[extname(file).toLowerCase()] || "application/octet-stream" });
    createReadStream(file).pipe(response);
  });
  server.listen(PAGE_PORT, "127.0.0.1", () => console.log(`Page:   http://127.0.0.1:${PAGE_PORT}/`));
}

function serveWorker() {
  // shell: true is what lets Windows find npx.cmd. Secrets come from worker/.dev.vars, which wrangler reads by itself.
  const child = spawn(`npx wrangler dev --port ${WORKER_PORT} --ip 127.0.0.1`, { cwd: WORKER, shell: true, stdio: "inherit" });
  child.on("exit", (code) => {
    console.error(`The local Worker stopped with code ${code}.`);
    process.exit(code ?? 1);
  });
  console.log(`Worker: http://127.0.0.1:${WORKER_PORT}/`);
}

function restore() {
  const clean = join(LAB, "clean");
  if (!existsSync(join(clean, "clients"))) {
    console.error(`${clean} has no clients folder. Make it first: see references/lab.md.`);
    process.exit(1);
  }
  for (const name of ["work", "drive", "usb"]) rmSync(join(LAB, name), { recursive: true, force: true });
  cpSync(clean, join(LAB, "work"), { recursive: true, preserveTimestamps: true });
  mkdirSync(join(LAB, "drive"));
  mkdirSync(join(LAB, "usb"));
  console.log(`Restored ${join(LAB, "work")} from clean; drive and usb are empty.`);
}

function status() {
  for (const name of ["clean", "work", "drive", "usb", "runs"]) {
    const folder = join(LAB, name);
    const count = existsSync(folder) ? readdirSync(folder).length : "missing";
    console.log(`${name.padEnd(6)} ${count}`);
  }
}

const command = process.argv[2];
if (command === "serve") {
  servePage();
  serveWorker();
} else if (command === "page") {
  servePage();
} else if (command === "restore") {
  restore();
} else if (command === "status") {
  status();
} else {
  console.error("Usage: node tools/lab.mjs serve | page | restore | status");
  process.exit(2);
}
