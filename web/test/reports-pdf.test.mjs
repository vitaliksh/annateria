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
  assert.ok(all.includes("סה״כ מע״מ לתשלום"));
  assert.ok(all.includes("10,000"));
  assert.ok(all.includes("תאריך - 03/10/26 08:05:09"));
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
