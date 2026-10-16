import test from "node:test";
import assert from "node:assert/strict";
import { buildIncomeRows, describeIncomeReport, hasIncomeRow, isIncomeReport, parseIncomeReport, readIncomeReportFile } from "../income-report.js";
import { detailPage, fakePdfJs, invoice, sampleReport, summaryPage } from "./income-report-fixture.mjs";

test("parses the period, totals and every document of a complete report and finds the listing equal to the totals", () => {
  const { pages } = sampleReport();
  assert.equal(isIncomeReport(pages), true);
  const report = parseIncomeReport(pages);
  assert.deepEqual(report.period, { from: "2026-09-01", to: "2026-09-30" });
  assert.equal(report.month, "2026-09");
  assert.deepEqual([report.taxable, report.exempt, report.vat, report.gross], [250.5, 0, 45.09, 295.59]);
  assert.equal(report.documents, 5);
  assert.deepEqual(report.sections.map(({ kind, declared, parsed }) => [kind, declared, parsed]), [["invoice", 3, 3], ["credit", 1, 1], ["other", 1, 1]]);
  assert.deepEqual(report.problems, []);
  assert.equal(report.verified, true);
});

test("a total that differs from the listing is reported and the report is not verified", () => {
  const report = parseIncomeReport(sampleReport({ tamper: { gross: 400.59, taxable: 355.5 } }).pages);
  assert.equal(report.verified, false);
  assert.deepEqual(report.problems.filter((problem) => problem.code === "sum-differs").map((problem) => problem.field).sort(), ["gross", "taxable"]);
  assert.match(describeIncomeReport(report), /נדרש עיון/);
});

test("a section that lists fewer documents than its heading declares is reported", () => {
  const { pages } = sampleReport();
  pages[1] = detailPage({ heading: { title: "חשבונית מס / קבלה", count: 4 }, rows: [invoice("1001", 100, 18), invoice("1002", 200.5, 36.09), invoice("1003", 50, 9)] });
  const report = parseIncomeReport(pages);
  assert.equal(report.verified, false);
  assert.ok(report.problems.some((problem) => problem.code === "section-count" && problem.declared === 4 && problem.parsed === 3));
});

test("a document line with a missing amount is counted as unreadable instead of being skipped", () => {
  const { pages } = sampleReport();
  pages[1] = detailPage({ heading: { title: "חשבונית מס / קבלה", count: 3 }, rows: [invoice("1001", 100, 18), { number: "1002", gross: 236.59, vat: 36.09, exempt: 0 }, invoice("1003", 50, 9)] });
  const report = parseIncomeReport(pages);
  assert.equal(report.verified, false);
  assert.ok(report.problems.some((problem) => problem.code === "unreadable-documents" && problem.count === 1));
});

test("a section continues over a page without a heading", () => {
  const rows = [invoice("1", 10, 1.8), invoice("2", 20, 3.6), invoice("3", 30, 5.4)];
  const pages = [
    summaryPage({ taxable: 60, vat: 10.8, gross: 70.8, documents: 3 }),
    detailPage({ heading: { title: "חשבונית מס / קבלה", count: 3 }, rows: rows.slice(0, 2) }),
    detailPage({ rows: rows.slice(2) }),
  ];
  const report = parseIncomeReport(pages);
  assert.deepEqual(report.sections.map(({ declared, parsed }) => [declared, parsed]), [[3, 3]]);
  assert.equal(report.verified, true);
});

test("without the document listing the totals are used and the text says the listing was not read", () => {
  const report = parseIncomeReport([summaryPage({ taxable: 100, vat: 18, gross: 118, documents: 7 })]);
  assert.equal(report.parsedDocuments, 0);
  assert.equal(report.verified, false);
  assert.equal(report.documents, 7);
  assert.match(describeIncomeReport(report), /פירוט המסמכים לא נקרא/);
});

test("pages that are not an income report give null, and a report without totals is an error", () => {
  assert.equal(parseIncomeReport([[]]), null);
  assert.equal(parseIncomeReport([detailPage({ rows: [invoice("1", 1, 0.18)] })]), null);
  const broken = summaryPage({ taxable: 1, vat: 0.18, gross: 1.18, documents: 1 }).filter((item) => item.str !== "סה״כ הכנסות כולל מע״מ" && !item.str.startsWith("₪1.18"));
  assert.throws(() => parseIncomeReport([broken]), /סיכום ההכנסות/);
});

test("exempt income becomes a second row with zero VAT; the report's own VAT is kept as printed", () => {
  const report = parseIncomeReport([summaryPage({ taxable: 1000.5, exempt: 500, vat: 180.09, gross: 1680.59, documents: 2 })]);
  const rows = buildIncomeRows(report, "110", { now: "2026-10-07T10:00:00.000Z", makeId: () => "id" });
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0].values.slice(0, 2).concat(rows[0].values.slice(7, 12)), ["30/09/26", "110", "1180.59", "1000.50", "180.09", "100", "100"]);
  assert.deepEqual(rows[1].values.slice(7, 10), ["500.00", "500.00", "0.00"]);
  assert.equal(rows[1].vatPercent, "0");
});

test("the income row uses the period end date, keeps no image and carries the verification text", () => {
  const rows = buildIncomeRows(parseIncomeReport(sampleReport().pages), "110", { now: "2026-10-07T10:00:00.000Z", makeId: () => "abc" });
  assert.equal(rows.length, 1);
  const [row] = rows;
  assert.equal(row.documentId, "income-abc");
  assert.equal(row.imageFile, "");
  assert.equal(row.active, true);
  assert.equal(row.values[0], "30/09/26");
  assert.deepEqual(row.values.slice(7, 10), ["295.59", "250.50", "45.09"]);
  assert.match(row.agentOpinion, /הפירוט נקרא ותואם לסיכום/);
  assert.equal(row.statusClass, "ready");
});

test("the same report is not added twice to a declaration", () => {
  const [row] = buildIncomeRows(parseIncomeReport(sampleReport().pages), "110");
  assert.equal(hasIncomeRow([], row), false);
  assert.equal(hasIncomeRow([{ active: true, values: [...row.values] }], row), true);
  assert.equal(hasIncomeRow([{ active: false, values: [...row.values] }], row), false);
  assert.equal(hasIncomeRow([{ active: true, values: ["30/09/26", "110", "", "", "", "", "", "100.00"] }], row), false);
});

test("reads a PDF file through pdf.js text items; other PDFs give null", async () => {
  const file = { name: "report.pdf", size: 10, type: "application/pdf", arrayBuffer: async () => new ArrayBuffer(10) };
  const report = await readIncomeReportFile(file, { loadPdf: fakePdfJs(sampleReport().pages) });
  assert.equal(report.verified, true);
  assert.equal(await readIncomeReportFile(file, { loadPdf: fakePdfJs([[{ str: "חשבונית מס", x: 10, y: 10, width: 50 }]]) }), null);
  await assert.rejects(() => readIncomeReportFile({ name: "x.txt", size: 3, type: "text/plain" }), /PDF/);
});
