import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { advancesReport, classificationLedger, profitLoss, reportEntries, vatReport } from "../reports.js";
import { formatStamp, layoutReport } from "../reports-pdf.js";
import { openReportWindow } from "../report-viewer.js";

const row = (code, net, vat, index = 0) => ({
  active: true,
  values: ["01/07/26", code, "", `ספק ${index}`, "", String(100 + index), "", String(net + vat), String(net), String(vat)],
});
const accounts = {
  160: { name: "הכנסות", type: "income" },
  202: { name: "משרדיות", type: "expense" },
  900: { name: "רכישת ציוד", type: "equipment" },
};
const declarations = [{
  month: "2026-07",
  status: "open",
  rows: [row("160", 10000, 1800), ...Array.from({ length: 90 }, (_, index) => row("202", 100, 18, index)), row("900", 1000, 180)],
}];
const entries = reportEntries(declarations, accounts, {});
const info = { clientName: "לקוח בדיקה", from: "07/2026", to: "07/2026" };
const now = new Date(2026, 9, 3, 8, 5, 9);
const texts = (pages) => pages.flat().filter((op) => op.type === "text").map((op) => op.text);

test("formatStamp: dd/mm/yy hh:mm:ss", () => {
  assert.equal(formatStamp(now), "03/10/26 08:05:09");
});

test("דוח מע״מ: הסכומים, אזהרת תנועות לא מעודכנות ושורת הסיכום", () => {
  const pages = layoutReport("vat", vatReport(entries), info, now);
  assert.equal(pages.length, 1);
  const all = texts(pages);
  assert.ok(all.includes("לקוח בדיקה"));
  assert.ok(all.includes("דוח מס ערך מוסף"));
  assert.ok(all.includes("קיימות 92 תנועות לא מעודכנות"));
  assert.ok(all.includes("הסכום לתשלום בשקלים חדשים"));
  assert.ok(all.includes("10,000"));
  assert.ok(all.includes("תאריך - 03/10/26 08:05:09"));
});

test("the VAT slip: each figure in the yellow box under its label, the exempt box empty, nothing under the slip", () => {
  const lines = { turnover: 79873, outputVat: 14377, inputVat: 1668, equipmentVat: 671, payable: 12038 };
  const report = { vatRate: 18, ...lines, openCount: 0 };
  const [page] = layoutReport("vat", report, { ...info, from: "07/2026", to: "08/2026", vatId: "014715726" }, now);
  const textOps = page.filter((op) => op.type === "text");
  const at = (value) => textOps.find((op) => op.text === value);
  // The yellow box that holds a text, and the label right above that box.
  const boxOf = (op) => page.find((item) => item.type === "rect" && item.fill === "#fff27a"
    && op.x <= item.x + item.width && op.x >= item.x && op.y >= item.y && op.y <= item.y + item.height);
  const labelOf = (box) => textOps.find((op) => op.x === box.x + box.width && op.y < box.y && op.y > box.y - 15)?.text;
  const figures = {
    "79,873": "עסקאות חייבות (ללא מע״מ)", "14,377": "המס על העסקאות", "671": "מס תשומות על ציוד ונכסים קבועים",
    "1,668": "המס על תשומות אחרות",
  };
  for (const [figure, label] of Object.entries(figures)) assert.equal(labelOf(boxOf(at(figure))), label, figure);
  assert.ok(boxOf(at("12,038")) && at("הסכום לתשלום בשקלים חדשים"));
  assert.ok(boxOf(at("יולי – אוגוסט 2026")) && boxOf(at("01471572-6")));
  const exempt = at("עסקאות פטורות או בשיעור אפס");
  const exemptBox = page.find((op) => op.type === "rect" && op.x + op.width === exempt.x
    && op.y > exempt.y && op.y < exempt.y + 15);
  assert.equal(textOps.some((op) => op.x > exemptBox.x && op.x < exemptBox.x + exemptBox.width
    && op.y > exemptBox.y && op.y < exemptBox.y + exemptBox.height), false);
  const footer = at("דוח עזר לרואה החשבון בלבד, אינו ייעוץ מס.");
  assert.ok(footer);
  assert.equal(page.some((op) => op.y > footer.y), false, "nothing is drawn under the footer");
  assert.equal(at("%מע״מ"), undefined);
  const refund = texts(layoutReport("vat", { ...report, equipmentVat: 0, payable: -40 }, info, now));
  assert.ok(refund.includes("הסכום להחזר בשקלים חדשים") && refund.includes("40"));
  assert.equal(refund.includes("0"), false, "a zero figure leaves its box empty");
});

test("the top line of every page: name on the right, VAT dealer number in the middle, address on the left", () => {
  const business = { ...info, vatId: "014715726", address: "Herzl 1" };
  const pages = layoutReport("ledger", classificationLedger(entries), business, now);
  assert.ok(pages.length > 1);
  const expected = [["לקוח בדיקה", "right"], ["עוסק מורשה: 01471572-6", "center"], ["Herzl 1", "left"]];
  for (const page of pages) {
    const top = page.filter((op) => op.type === "text" && op.y === 62);
    assert.deepEqual(top.map((op) => [op.text, op.align]), expected);
  }
  const bare = layoutReport("vat", vatReport(entries), info, now)[0].filter((op) => op.type === "text" && op.y === 62);
  assert.deepEqual(bare.map((op) => op.text), ["לקוח בדיקה"]);
});

test("דוח מקדמות ודוח רווח והפסד: שדות עיקריים", () => {
  const advances = texts(layoutReport("advances", advancesReport(entries, { percent: 12 }), info, now));
  assert.ok(advances.includes("אחוז מקדמות מהמחזור = 12%"));
  assert.ok(advances.includes("1,200"));
  const pl = texts(layoutReport("profitLoss", profitLoss(entries), info, now));
  assert.ok(pl.includes("ללא מס ערך מוסף"));
  assert.ok(pl.includes("(9,000)"));
  assert.ok(pl.includes("רווח לתקופה:"));
});

test("כרטסת: מתפרסת על כמה עמודים עם כותרות חוזרות ומספור עמודים", () => {
  const pages = layoutReport("ledger", classificationLedger(entries), info, now);
  assert.ok(pages.length > 1);
  pages.forEach((page, index) => {
    assert.ok(texts([page]).includes(`דף ${index + 1} מתוך ${pages.length}`));
  });
  assert.ok(texts([pages[1]]).includes("הוצאות הנהלה וכלליות"));
  assert.ok(texts([pages[1]]).includes("קוד מס': 202"));
  assert.ok(texts(pages).includes("סה״כ לדוח:"));
  const rows = texts(pages).filter((value) => /^ספק \d+$/.test(value));
  assert.equal(rows.length, 92);
});

test("חלון הצגה: כפתורי שמירה, שמירה בשם וסגירה; ביטול הדיאלוג אינו שגיאה", async () => {
  const win = new JSDOM("<!doctype html><title>x</title>").window;
  let closed = 0;
  win.close = () => { closed += 1; };
  const viewer = openReportWindow({ open: () => win });
  const doc = win.document;
  assert.equal(doc.querySelector("#save").disabled, true);
  const saved = [];
  viewer.show({
    title: "דוח בדיקה",
    pageUrls: ["a.jpg", "b.jpg"],
    save: async () => { saved.push("save"); return "נשמר: reports/x.pdf"; },
    saveAs: async (target) => {
      saved.push(target === win ? "saveAs" : "wrong window");
      throw Object.assign(new Error("cancelled"), { name: "AbortError" });
    },
  });
  assert.equal(doc.title, "דוח בדיקה");
  assert.equal(doc.querySelectorAll("#pages img").length, 2);
  doc.querySelector("#save").click();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(doc.querySelector("#status").textContent, "נשמר: reports/x.pdf");
  doc.querySelector("#save-as").click();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual(saved, ["save", "saveAs"]);
  assert.equal(doc.querySelector("#status").textContent, "");
  doc.querySelector("#close").click();
  assert.equal(closed, 1);
  assert.equal(openReportWindow({ open: () => null }), null);
});

test("חלון הצגה: שגיאת שמירה מוצגת בשורת הסטטוס", async () => {
  const win = new JSDOM("<!doctype html>").window;
  const viewer = openReportWindow({ open: () => win });
  viewer.show({ title: "t", pageUrls: [], save: async () => { throw new Error("denied"); }, saveAs: async () => "" });
  win.document.querySelector("#save").click();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.match(win.document.querySelector("#status").textContent, /denied/);
  assert.ok(win.document.querySelector("#status").classList.contains("error"));
});
