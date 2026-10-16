// Synthetic text layers of an income report, laid out like the real one: right-aligned amount columns, section headings
// split around the document count, totals as "value left of label". All names and amounts here are invented.
const width = (text) => Math.max(6, text.length * 6);
const rightAt = (text, right, y) => ({ str: text, x: right - width(text), y, width: width(text) });
const leftAt = (text, x, y) => ({ str: text, x, y, width: width(text) });
const shekel = (value) => `₪${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const plain = (value) => value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const COLUMNS = { number: 549, gross: 92, vat: 127, exempt: 182, taxable: 235 };

export function summaryPage({ from = "01/09/2026", to = "30/09/2026", taxable, exempt = 0, vat, gross, documents }) {
  const row = (y, label, value, labelRight, valueRight) => [rightAt(label, labelRight, y), rightAt(shekel(value), valueRight, y)];
  return [
    rightAt("דיווח הכנסות תקופתי", 553, 570),
    rightAt("לתקופה", 553, 551),
    rightAt(to, 517, 551),
    rightAt("-", 464, 551),
    rightAt(from, 458, 551),
    rightAt("סיכום הכנסות ותקבולים )", 553, 518),
    rightAt(String(documents), 449, 518),
    rightAt("מסמכים(", 431, 518),
    ...row(390, "סה״כ הכנסות חייבות", taxable, 548, 420),
    ...row(363, "סה״כ הכנסות פטורות", exempt, 548, 420),
    ...row(311, "סה״כ הכנסות כולל", taxable + exempt, 548, 420),
    ...row(285, "מע״מ", vat, 548, 420),
    ...row(259, "סה״כ הכנסות כולל מע״מ", gross, 548, 420),
    ...row(442, "סה״כ כרטיסי אשראי", gross, 293, 165),
  ];
}

// heading: { title, count } on the first page of a section, null on its continuation pages.
export function detailPage({ heading = null, rows }) {
  const items = [];
  let y = 793;
  if (heading) {
    items.push(rightAt(`${heading.title} )`, 552, y), rightAt(String(heading.count), 461, y), rightAt("מסמכים(", 441, y));
    y -= 26;
  }
  const header = y;
  items.push(
    rightAt("סה״כ", COLUMNS.gross, header),
    rightAt('מע"מ', COLUMNS.vat, header),
    rightAt('פטור מע"מ', COLUMNS.exempt, header),
    rightAt('חייב מע"מ', COLUMNS.taxable, header),
    rightAt("מספר הקצאה", 302, header),
    rightAt("פרטי הלקוח", 450, header),
    rightAt("תאריך", 512, header),
    rightAt("מס'", COLUMNS.number, header),
  );
  y -= 33;
  for (const row of rows) {
    items.push(rightAt(row.number, COLUMNS.number, y), rightAt(row.date ?? "02/09/2026", 510, y), leftAt("לקוח לדוגמה", 417, y + 8));
    if (row.gross !== undefined) items.push(rightAt(shekel(row.gross), COLUMNS.gross, y));
    if (row.vat !== undefined) items.push(rightAt(plain(row.vat), COLUMNS.vat, y));
    if (row.exempt !== undefined) items.push(rightAt(plain(row.exempt), COLUMNS.exempt, y));
    if (row.taxable !== undefined) items.push(rightAt(plain(row.taxable), COLUMNS.taxable, y));
    // the payment line below a document repeats its gross amount in the first column; it has no document number
    items.push(leftAt("תשלום", 369, y - 60), rightAt(shekel(row.gross ?? 0), COLUMNS.gross, y - 60));
    y -= 85;
  }
  return items;
}

export const invoice = (number, taxable, vat, extra = {}) => ({ number, taxable, vat, exempt: 0, gross: Math.round((taxable + vat) * 100) / 100, ...extra });

// A complete report: 3 invoices and one credit note (cancelling the first one) plus its negative receipt.
export function sampleReport({ tamper = {} } = {}) {
  const invoices = [invoice("1001", 100, 18), invoice("1002", 200.5, 36.09), invoice("1003", 50, 9)];
  const credit = invoice("7001", 100, 18);
  const receipt = { number: "8001", gross: -118, vat: 0, exempt: 0, taxable: 0 };
  const totals = { taxable: 250.5, vat: 45.09, gross: 295.59, documents: 5, ...tamper };
  return {
    pages: [
      summaryPage(totals),
      detailPage({ heading: { title: "חשבונית מס / קבלה", count: 3 }, rows: invoices }),
      detailPage({ heading: { title: "חשבונית זיכוי", count: 1 }, rows: [credit] }),
      detailPage({ heading: { title: "קבלה", count: 1 }, rows: [receipt] }),
    ],
    invoices,
    credit,
    receipt,
  };
}

// A fake pdf.js with the given pages (lists of { str, x, y, width }).
export function fakePdfJs(pages) {
  return async () => ({
    getDocument: () => ({
      promise: Promise.resolve({
        numPages: pages.length,
        getPage: async (number) => ({
          getTextContent: async () => ({ items: pages[number - 1].map((item) => ({ str: item.str, transform: [1, 0, 0, 1, item.x, item.y], width: item.width })) }),
        }),
      }),
    }),
  });
}
