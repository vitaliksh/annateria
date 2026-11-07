// A real Chrome window for the lab, driven from the command line, one command at a time (references/lab.md).
// The embedded browser of the desktop app answers the folder picker with AbortError at once, so the month is worked here instead.
//
//   node tools/browser.mjs start                 opens the window and keeps writing its console to D:\ANNATERIA-LAB\browser.log
//   node tools/browser.mjs shot [name]           a picture of the page; prints where it went
//   node tools/browser.mjs text                  the visible text of the page
//   node tools/browser.mjs buttons               visible buttons, links and fields, with the number each click can use
//   node tools/browser.mjs click <text|#n|css>   a real mouse click on what shows this text, on number n of `buttons`, or on a selector
//   node tools/browser.mjs at <x> <y>            a real mouse click at a point of the page
//   node tools/browser.mjs type <text>           real key presses into what has the focus
//   node tools/browser.mjs press <key>           one key, such as Enter or Escape
//   node tools/browser.mjs select <css> <value>  chooses in a drop-down list
//   node tools/browser.mjs clear <css>           selects what a field holds and deletes it, as a person would
//   node tools/browser.mjs files <css> <path>..  answers the file dialog of an input: the one thing replaced, the rest stays real
//   node tools/browser.mjs look <expression>     evaluates an expression to read the page. Never to act: rule 1 of the skill
//   node tools/browser.mjs until <s> <expression>  waits for a condition on the page
//
// Native Windows dialogs (the folder picker, the save dialog) are answered by tools/windows-dialog.ps1.
import { spawn } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright-core";

const LAB = process.env.ANNATERIA_LAB || "D:\\ANNATERIA-LAB";
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = Number(process.env.LAB_CHROME_PORT || 9333);
const PAGE = `http://127.0.0.1:${process.env.LAB_PAGE_PORT || 8000}/`;
const SHOTS = join(LAB, "shots");
const LOG = join(LAB, "browser.log");
const VISIBLE = "button, a, input, select, textarea, summary, [role=button], [role=tab], [role=menuitem]";

async function connect() {
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
  const pages = browser.contexts()[0].pages();
  const page = pages.find((candidate) => candidate.url().startsWith(PAGE)) || pages[0];
  if (!page) throw new Error("The browser has no page. Run start first.");
  return { browser, page };
}

async function start() {
  mkdirSync(join(LAB, "browser-profile"), { recursive: true });
  const window = spawn(CHROME, [
    `--user-data-dir=${join(LAB, "browser-profile")}`,
    `--remote-debugging-port=${PORT}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--window-position=60,40",
    "--window-size=1500,1050",
    PAGE,
  ], { detached: true, stdio: "ignore" });
  window.unref();
  let browser;
  for (let attempt = 0; attempt < 40 && !browser; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`).catch(() => null);
  }
  if (!browser) throw new Error("Chrome did not answer on the debugging port.");
  const write = (line) => appendFileSync(LOG, `${new Date().toISOString()} ${line}\n`);
  const follow = (page) => {
    page.on("console", (message) => write(`[${message.type()}] ${message.text()}`));
    page.on("pageerror", (error) => write(`[pageerror] ${error.message}`));
    page.on("requestfailed", (request) => write(`[requestfailed] ${request.method()} ${request.url().split("?")[0]} ${request.failure()?.errorText}`));
  };
  const context = browser.contexts()[0];
  context.pages().forEach(follow);
  context.on("page", follow);
  console.log(`Chrome is open on ${PAGE}; console goes to ${LOG}. This process stays until the window closes.`);
  await new Promise((resolve) => browser.on("disconnected", resolve));
}

// The visible things a person could click, in reading order.
const listVisible = (page, scrollIndex = null) => page.evaluate(([selector, scrollTo]) => {
  const shown = [...document.querySelectorAll(selector)].filter((element) => {
    const box = element.getBoundingClientRect();
    if (!box.width || !box.height) return false;
    const style = getComputedStyle(element);
    if (style.visibility === "hidden" || style.display === "none") return false;
    const dialog = document.elementFromPoint(innerWidth / 2, innerHeight / 2)?.closest("dialog[open]") || document.querySelector("dialog[open]:modal");
    return !dialog || dialog.contains(element);
  });
  if (scrollTo !== null) shown[scrollTo]?.scrollIntoView({ block: "center" });
  return shown.map((element, index) => {
    const box = element.getBoundingClientRect();
    return {
      n: index,
      tag: element.tagName.toLowerCase(),
      id: element.id || "",
      text: (element.innerText || element.value || element.getAttribute("aria-label") || element.placeholder || "").trim().replace(/\s+/g, " ").slice(0, 70),
      disabled: element.disabled === true,
      x: Math.round(box.x + box.width / 2),
      y: Math.round(box.y + box.height / 2),
    };
  });
}, [VISIBLE, scrollIndex]);

// Brings item n into view, as a person scrolls to it, and clicks it where it then stands.
async function clickItem(page, n) {
  const item = (await listVisible(page, n))[n];
  if (!item) throw new Error(`No item #${n} on the page.`);
  await page.mouse.click(item.x, item.y);
  return `${item.tag} "${item.text}" at ${item.x},${item.y}`;
}

async function clickTarget(page, target) {
  if (/^#\d+$/.test(target)) return clickItem(page, Number(target.slice(1)));
  if (/^[#.\[]/.test(target)) {
    await page.locator(target).first().click({ timeout: 5000 });
    return target;
  }
  const items = await listVisible(page);
  const item = items.find((candidate) => candidate.text === target) || items.find((candidate) => candidate.text.includes(target));
  if (item) return clickItem(page, item.n);
  await page.getByText(target).first().click({ timeout: 5000 });
  return `text "${target}"`;
}

const [command, ...args] = process.argv.slice(2);
if (command === "start") {
  await start();
} else if (command) {
  const { browser, page } = await connect();
  try {
    if (command === "shot") {
      mkdirSync(SHOTS, { recursive: true });
      const file = join(SHOTS, `${args[0] || "latest"}.png`);
      await page.screenshot({ path: file, timeout: 20000 });
      console.log(file);
    } else if (command === "text") {
      console.log(await page.evaluate(() => {
        const dialog = document.elementFromPoint(innerWidth / 2, innerHeight / 2)?.closest("dialog[open]") || document.querySelector("dialog[open]:modal");
        return (dialog || document.body).innerText;
      }));
    } else if (command === "buttons") {
      for (const item of await listVisible(page)) {
        const id = item.id ? ` ${item.id}` : "";
        console.log(`#${item.n} ${item.tag}${id}${item.disabled ? " (disabled)" : ""}: ${item.text}`);
      }
    } else if (command === "click") {
      console.log("clicked", await clickTarget(page, args.join(" ")));
    } else if (command === "at") {
      await page.mouse.click(Number(args[0]), Number(args[1]));
    } else if (command === "select") {
      // The one native list of a <select> cannot be driven by mouse from here; the choice and its events are the real ones.
      console.log("selected", await page.locator(args[0]).first().selectOption(args.slice(1).join(" ")));
    } else if (command === "clear") {
      await page.locator(args[0]).first().click({ clickCount: 3, timeout: 5000 });
      await page.keyboard.press("Backspace");
    } else if (command === "type") {
      await page.keyboard.type(args.join(" "));
    } else if (command === "press") {
      await page.keyboard.press(args[0]);
    } else if (command === "files") {
      const [selector, ...paths] = args;
      for (const path of paths) if (!existsSync(path)) throw new Error(`No such file: ${path}`);
      await page.locator(selector).first().setInputFiles(paths);
    } else if (command === "look") {
      console.log(JSON.stringify(await page.evaluate(args.join(" ")), null, 1));
    } else if (command === "until") {
      // until <seconds> <expression>: waits for a condition on the page, and says how long it took.
      const started = Date.now();
      await page.waitForFunction(args.slice(1).join(" "), null, { timeout: Number(args[0]) * 1000, polling: 1000 });
      console.log(`after ${Math.round((Date.now() - started) / 1000)} s`);
    } else if (command === "go") {
      await page.goto(args[0] || PAGE);
    } else {
      throw new Error(`Unknown command: ${command}`);
    }
  } catch (error) {
    console.log(`FAILED: ${error.message.split(/\r?\n/)[0]}`);
    process.exitCode = 1;
  } finally {
    // Disconnect only: the window stays open and keeps its state.
    await browser.close();
  }
} else {
  console.error("Usage: see the head of tools/browser.mjs");
  process.exit(2);
}
