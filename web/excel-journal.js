// Pure parser for the Rivhit journal grid; the layout is described in docs/EXCEL_IMPORT_SPEC.md.
const COL = { status: 0, vat: 1, net: 3, gross: 4, ref2: 5, ref1: 6, details: 8, cls: 11, line: 12, date: 13 };
const INCOME_CLASS = "הכנסות";
export const DEFAULT_CLASS_TYPES = {
  income: [INCOME_CLASS],
  equipment: ["רכישת ציוד/רכוש קבוע"],
  outsideVatBase: ["ביטוח עסק", "ארנונה"],
};
const MONEY_TEXT = /^\(?[\d,]+(?:\.\d+)?\)?$/;
const TOLERANCE = 0.011;

const round2 = (value) => Math.round(value * 100) / 100;
const clean = (cell) => String(cell ?? "").replace(/[‎‏ ]/g, " ").trim();

function parseMoney(cell) {
  const text = clean(cell);
  if (!MONEY_TEXT.test(text)) return null;
  const value = Number(text.replace(/[(),]/g, ""));
  return round2(text.startsWith("(") ? -value : value);
}

function parseDate(cell) {
  if (typeof cell === "number" && Number.isFinite(cell)) {
    return new Date(Date.UTC(1899, 11, 30) + Math.floor(cell) * 86400000).toISOString().slice(0, 10);
  }
  const text = clean(cell);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

function parseDeclarationMonth(rows, headerIndex) {
  for (const cells of rows.slice(0, headerIndex)) {
    for (const cell of cells) {
      const match = clean(cell).match(/^לחודש\s+(\d{1,2})\/(\d{4})$/);
      if (match) return { month: Number(match[1]), year: Number(match[2]) };
    }
  }
  return null;
}

function parseFooter(rows, from) {
  const footer = {};
  const labels = [
    [/^סיכום אריטמטי ללא מע"מ לביקורת$/, "arithmeticNet"],
    [/^סיכום אריטמטי כולל מע"מ לביקורת$/, "arithmeticGross"],
    [/^ת\.ציוד כולל$/, "equipmentGross"],
    [/^תשומות כולל$/, "inputsGross"],
    [/^עסקאות כולל$/, "outputsGross"],
    [/^מע"מ ת\.ציוד$/, "equipmentVat"],
    [/^מע"מ תשומות$/, "inputsVat"],
    [/^מע"מ עסקאות$/, "outputsVat"],
  ];
  for (const cells of rows.slice(from)) {
    cells.forEach((cell, col) => {
      const text = clean(cell).replace(/''/g, '"');
      if (text === ':סה"כ מע"מ לחודש') footer.totalVat = parseMoney(cells[col - 3]);
      const match = text.match(/^(.+?)\s*:\s*([\d,.()]+)$/);
      const entry = match && labels.find(([pattern]) => pattern.test(match[1].replace(/\s+/g, " ")));
      if (entry) footer[entry[1]] = parseMoney(match[2]);
    });
  }
  return footer;
}

function parseRow(cells, rowNumber, errors) {
  const fail = (code, message) => errors.push({ code, message, row: rowNumber });
  const [vat, net, gross] = [COL.vat, COL.net, COL.gross].map((col) => parseMoney(cells[col]));
  const date = parseDate(cells[COL.date]);
  const classificationName = clean(cells[COL.cls]);
  if ([vat, net, gross].includes(null)) fail("bad-money", "VAT, net or gross is not a number");
  else if (Math.abs(Math.abs(net) + Math.abs(vat) - Math.abs(gross)) > TOLERANCE) {
    fail("amount-mismatch", "net plus VAT does not equal gross");
  }
  if (!date) fail("bad-date", "document date is missing or not a date");
  if (!classificationName) fail("no-classification", "classification name is empty");
  const kind = classificationName === INCOME_CLASS ? "income" : net < 0 || gross < 0 ? "credit" : "expense";
  return {
    status: clean(cells[COL.status]),
    vat,
    net,
    gross,
    reference1: clean(cells[COL.ref1]),
    reference2: clean(cells[COL.ref2]),
    details: clean(cells[COL.details]),
    classificationName,
    line: clean(cells[COL.line]),
    date,
    kind,
    sourceRow: rowNumber,
  };
}

function sumBy(rows, field, sign = 1) {
  return round2(rows.reduce((total, row) => total + sign * row[field], 0));
}

function checkFooter(rows, footer, classTypes, errors) {
  const group = (names) => rows.filter((row) => names.includes(row.classificationName));
  const equipment = group(classTypes.equipment);
  const outputs = rows.filter((row) => row.kind === "income" || classTypes.income.includes(row.classificationName));
  const inputs = rows.filter(
    (row) => !outputs.includes(row) && !equipment.includes(row) && !classTypes.outsideVatBase.includes(row.classificationName),
  );
  // Expense VAT is negative in the file while the footer shows it as a positive magnitude.
  const expected = {
    totalVat: sumBy(rows, "vat"),
    arithmeticNet: sumBy(rows, "net"),
    arithmeticGross: sumBy(rows, "gross"),
    outputsGross: sumBy(outputs, "gross"),
    outputsVat: sumBy(outputs, "vat"),
    equipmentGross: sumBy(equipment, "gross"),
    equipmentVat: sumBy(equipment, "vat", -1),
    inputsGross: sumBy(inputs, "gross"),
    inputsVat: sumBy(inputs, "vat", -1),
  };
  for (const [key, value] of Object.entries(expected)) {
    if (footer[key] == null) errors.push({ code: "footer-missing", message: `footer value ${key} not found`, key });
    else if (Math.abs(footer[key] - value) > TOLERANCE) {
      errors.push({ code: "footer-mismatch", message: `footer ${key} ${footer[key]} differs from rows ${value}`, key });
    }
  }
  // The month total is the plain sum of the VAT column, so it also holds VAT of rows outside the input base
  // (signed as in the file), which the inputs line leaves out.
  const outsideVat = sumBy(group(classTypes.outsideVatBase), "vat");
  const balance = round2(footer.outputsVat - footer.inputsVat - footer.equipmentVat + outsideVat);
  if (footer.totalVat != null && Math.abs(footer.totalVat - balance) > TOLERANCE) {
    errors.push({ code: "footer-mismatch", message: `total VAT ${footer.totalVat} differs from ${balance}`, key: "balance" });
  }
}

// Footer checks alone, for re-running them on parsed rows after the user changed class types.
export function footerErrors(rows, footer, classTypes = DEFAULT_CLASS_TYPES) {
  const errors = [];
  checkFooter(rows, footer, classTypes, errors);
  return errors;
}

// Finds the class types ({ name: type }) under which every footer check passes, changing as few of `current` as
// possible; null when no assignment fits, the footer is incomplete or the file has too many classes to search.
export function suggestClassTypes(rows, footer, current = {}) {
  const keys = ["outputsGross", "outputsVat", "equipmentGross", "equipmentVat", "inputsGross", "inputsVat", "totalVat"];
  if (keys.some((key) => footer[key] == null)) return null;
  const names = [...new Set(rows.map((row) => row.classificationName))];
  if (!names.length || names.length > 16) return null;
  const cents = (value) => Math.round(value * 100);
  const near = (a, b) => Math.abs(a - b) <= 1;
  const gross = names.map(() => 0);
  const vat = names.map(() => 0);
  for (const row of rows) {
    const index = names.indexOf(row.classificationName);
    gross[index] += cents(row.gross);
    vat[index] += cents(row.vat);
  }
  const full = (1 << names.length) - 1;
  const sumGross = new Float64Array(full + 1);
  const sumVat = new Float64Array(full + 1);
  for (let mask = 1; mask <= full; mask += 1) {
    const low = 31 - Math.clz32(mask & -mask);
    const rest = mask & (mask - 1);
    sumGross[mask] = sumGross[rest] + gross[low];
    sumVat[mask] = sumVat[rest] + vat[low];
  }
  const [outputsGross, outputsVat, equipmentGross, equipmentVat, inputsGross, inputsVat, totalVat] = keys.map((key) => cents(footer[key]));
  const incomes = [];
  const equipments = [];
  for (let mask = 0; mask <= full; mask += 1) {
    if (near(sumGross[mask], outputsGross) && near(sumVat[mask], outputsVat)) incomes.push(mask);
    if (near(sumGross[mask], equipmentGross) && near(-sumVat[mask], equipmentVat)) equipments.push(mask);
  }
  let best = null;
  let bestScore = Infinity;
  let budget = 3_000_000;
  for (const income of incomes) {
    for (const equipment of equipments) {
      if (income & equipment) continue;
      const rest = full & ~(income | equipment);
      for (let outside = rest; budget > 0; outside = (outside - 1) & rest) {
        budget -= 1;
        const inputs = rest & ~outside;
        if (near(sumGross[inputs], inputsGross) && near(-sumVat[inputs], inputsVat) && near(outputsVat - inputsVat - equipmentVat + sumVat[outside], totalVat)) {
          const types = names.map((_, i) => {
            const bit = 1 << i;
            return income & bit ? "income" : equipment & bit ? "equipment" : outside & bit ? "outsideVatBase" : "expense";
          });
          const score = types.filter((type, i) => type !== (current[names[i]] ?? "expense")).length;
          if (score < bestScore) [best, bestScore] = [types, score];
        }
        if (outside === 0) break;
      }
    }
  }
  return best && Object.fromEntries(names.map((name, i) => [name, best[i]]));
}

// `rows` is a 0-based grid of cells; dates may be Excel serial numbers or ISO strings.
export function parseJournalGrid(rows, { classTypes = DEFAULT_CLASS_TYPES } = {}) {
  const errors = [];
  const warnings = [];
  const headerIndex = rows.findIndex((cells) => clean(cells[COL.status]) === "סטטוס");
  if (headerIndex < 0) {
    errors.push({ code: "no-header", message: "journal header row (סטטוס) not found" });
    return { declarationMonth: null, rows: [], footer: {}, errors, warnings };
  }
  const parsed = [];
  let last = headerIndex;
  rows.forEach((cells, index) => {
    if (index <= headerIndex || clean(cells[COL.date]) === "") return;
    parsed.push(parseRow(cells, index + 1, errors));
    last = index;
  });
  if (!parsed.length) errors.push({ code: "no-rows", message: "no transaction rows found" });
  const footer = parseFooter(rows, last + 1);
  if (parsed.length && !errors.some((error) => error.row)) checkFooter(parsed, footer, classTypes, errors);
  const declarationMonth = parseDeclarationMonth(rows, headerIndex);
  if (!declarationMonth) warnings.push({ code: "no-month", message: "declaration month not found in the header" });
  const drafts = parsed.filter((row) => row.status === "טיוטא").length;
  if (drafts) warnings.push({ code: "draft-rows", message: `${drafts} rows have draft status (not final in the source)`, count: drafts });
  const others = parsed.filter((row) => row.status !== "טיוטא").length;
  if (others) warnings.push({ code: "other-status", message: `${others} rows have a status other than draft`, count: others });
  return { declarationMonth, rows: parsed, footer, errors, warnings };
}
