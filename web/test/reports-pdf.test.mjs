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
  const lines = { taxableSales: 79873, exemptSales: 0, outputVat: 14377, inputVat: 1668, equipmentVat: 671 };
  const report = { vatRate: 18, ...lines, payable: 12038, openCount: 0 };
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
  const [withExempt] = layoutReport("vat", { ...report, exemptSales: 21674 }, info, now);
  const exemptFigure = withExempt.find((op) => op.type === "text" && op.text === "21,674");
  assert.ok(exemptFigure, "the exempt sales are drawn");
  assert.ok(exemptFigure.x > exemptBox.x && exemptFigure.x <= exemptBox.x + exemptBox.width
    && exemptFigure.y > exemptBox.y && exemptFigure.y < exemptBox.y + exemptBox.height, "in the exempt box");
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
  assert.equal(pl.includes("רווח גולמי לתקופה:"), false, "no cost of sales, no gross profit line");
  const withCost = texts(layoutReport("profitLoss", profitLoss(entries.map((entry, index) => (index === 1 ? { ...entry, costOfSales: true } : entry))), info, now));
  assert.ok(withCost.includes("עלות המכר") && withCost.includes("רווח גולמי לתקופה:"));
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

// The owner, 10 November 2026: the report opens inside the page, modal, and saves only into the client's folder.
test("the report dialog is modal inside the page, saves into the client's folder, and closes", async () => {
  const win = new JSDOM("<!doctype html><title>x</title><body><main>work</main></body>").window;
  let modal = 0;
  win.HTMLDialogElement.prototype.showModal = function showModal() { modal += 1; this.open = true; };
  win.HTMLDialogElement.prototype.close = function close() { this.open = false; };
  let printed = 0;
  win.print = () => { printed += 1; };
  const doc = win.document;
  const viewer = openReportWindow({ document: doc });
  const dialog = doc.querySelector("#report-dialog");
  assert.equal(modal, 1, "the work behind it is locked at once");
  assert.equal(doc.querySelector("#report-save").disabled, true);
  viewer.show({ title: "דוח בדיקה", pageUrls: ["a.jpg", "b.jpg"], save: async () => "הדוח נשמר בתיקיית הלקוח: c/reports/x.pdf", notice: "דוח לתקופה הזו כבר נשמר." });
  assert.equal(doc.querySelectorAll("#report-pages img").length, 2);
  assert.equal(doc.querySelector("#report-status").textContent, "דוח לתקופה הזו כבר נשמר.");
  assert.equal(doc.querySelector("#report-save-as"), null, "no save into a folder picked at random");
  doc.querySelector("#report-save").click();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(doc.querySelector("#report-status").textContent, "הדוח נשמר בתיקיית הלקוח: c/reports/x.pdf");
  doc.querySelector("#report-dialog-print").click();
  assert.equal(printed, 1);
  doc.querySelector("#report-close").click();
  assert.equal(dialog.open, false);
  const again = openReportWindow({ document: doc });
  again.show({ title: "t", pageUrls: [], save: async () => { throw new Error("denied"); } });
  doc.querySelector("#report-save").click();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.match(doc.querySelector("#report-status").textContent, /denied/);
  assert.ok(doc.querySelector("#report-status").classList.contains("error"));
  assert.equal(doc.querySelectorAll("#report-dialog").length, 1, "one dialog is reused");
});
