// Dialog for the one-time Excel migration. All logic lives in excel-import-flow.js; this file only renders.
import { ACCOUNT_TYPES } from "./chart-of-accounts.js";
import { readClientChart } from "./chart-of-accounts.js";
import { commitImport, prepareImport, recheckImport } from "./excel-import-flow.js";
import { inspectImportTarget } from "./excel-import-store.js";
import { formatMonth, parseMonthText } from "./month-format.js";

export const TYPE_LABELS = {
  income: "הכנסה",
  expense: "הוצאה",
  outsideVatBase: "הוצאה מחוץ לבסיס מע״מ",
  equipment: "ציוד",
};
const money = (value) => value.toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Hebrew texts for the parser's English diagnostics; unknown codes fall back to the original message.
const PROBLEM_TEXTS = {
  "draft-rows": (item) => `ל-${item.count} שורות סטטוס «טיוטא» במקור (לא סופי ב-Rivhit)`,
  "other-status": (item) => `ל-${item.count} שורות סטטוס שונה מ«טיוטא»`,
  "no-month": () => "חודש ההצהרה לא נמצא בכותרת הקובץ",
  "reference2-dropped": (item) => `ל-${item.count} שורות יש אסמכתא 2, והיא לא מיובאת`,
  "no-header": () => "לא נמצאה שורת הכותרת של היומן (סטטוס)",
  "no-rows": () => "לא נמצאו שורות תנועה",
  "bad-money": () => "סכום מע״מ, נטו או ברוטו אינו מספר",
  "amount-mismatch": () => "נטו + מע״מ אינם שווים לברוטו",
  "bad-date": () => "תאריך המסמך חסר או אינו תקין",
  "no-classification": () => "שם קוד המיון ריק",
  "footer-missing": (item) => `ערך ${item.key} לא נמצא בסוף הקובץ`,
  "footer-mismatch": (item) => `סכום «${FOOTER_LABELS[item.key] ?? item.key}» בסוף הקובץ אינו תואם לשורות`,
};
// The footer lines as Rivhit labels them; `balance` is the check that total VAT = outputs − inputs − equipment.
const FOOTER_LABELS = {
  totalVat: "סה״כ מע״מ לחודש",
  arithmeticNet: "סיכום ללא מע״מ",
  arithmeticGross: "סיכום כולל מע״מ",
  outputsGross: "עסקאות כולל",
  outputsVat: "מע״מ עסקאות",
  inputsGross: "תשומות כולל",
  inputsVat: "מע״מ תשומות",
  equipmentGross: "ת.ציוד כולל",
  equipmentVat: "מע״מ ת.ציוד",
  balance: "סה״כ מע״מ = עסקאות − תשומות − ציוד",
};
export const problemText = (item) => PROBLEM_TEXTS[item.code]?.(item) ?? item.message;

// First free three-digit code from 200 up, skipping codes already used or reserved.
export function suggestCode(used) {
  for (let code = 200; code <= 999; code += 1) if (!used[String(code)]) return String(code);
  return "";
}

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

// getContext() returns { dataRoot, client, reserved } or null when no data root or client is selected.
// What the user is told about the chosen month; the import is blocked for a closed declaration.
const TARGET_TEXTS = {
  missing: (month) => `ההצהרה ל-${month} לא קיימת ותיווצר.`,
  empty: (month) => `ההצהרה ל-${month} קיימת וריקה. השורות ייכנסו אליה.`,
  rows: (month, count) => `ב-${month} כבר יש ${count} שורות.`,
  closed: (month) => `ההצהרה ל-${month} נעולה, אי אפשר לייבא אליה.`,
};

// onBeforeCommit(month) lets the host stop editing the target declaration before the rows are written.
export function setupExcelImport({ button, dialog, getContext, onImported, onError, loadLibrary, onBeforeCommit, onOpenCodes }) {
  const part = (id) => dialog.querySelector(`#${id}`);
  const [file, details, summary, problems, month, unknownBox, unknownList, closeNow, errorLine, run] = [
    "excel-import-file", "excel-import-details", "excel-import-summary", "excel-import-problems", "excel-import-month",
    "excel-import-unknown", "excel-import-unknown-list", "excel-import-close", "excel-import-error", "excel-import-run",
  ].map(part);
  const [clientLine, targetLine, replaceLabel, replaceBox, replaceText] = [
    "excel-import-client", "excel-import-target", "excel-import-replace-label", "excel-import-replace",
    "excel-import-replace-text",
  ].map(part);
  const [nextButton, backButton, resultLine] = ["excel-import-next", "excel-import-back", "excel-import-result"].map(part);
  const unknownText = part("excel-import-unknown-text");
  const warningList = part("excel-import-warnings");
  const [codesLine, codesButton] = ["excel-import-codes", "excel-import-codes-open"].map(part);
  let prepared = null;
  let context = null;
  let target = null;
  let targetCheck = 0;

  // The dialog keeps one size; the step only decides which panel and which buttons are shown (see dialogs.css).
  const STEP_ORDER = ["file", "check", "month", "done"];
  const setStep = (step) => {
    dialog.dataset.step = step;
    dialog.querySelectorAll("[data-step-name]").forEach((item) => {
      const position = STEP_ORDER.indexOf(item.dataset.stepName) - STEP_ORDER.indexOf(step);
      item.dataset.state = position === 0 ? "current" : position < 0 ? "done" : "todo";
    });
  };

  const updateRunState = () => {
    const blocked = !target || target.state === "closed" || (target.state === "rows" && !replaceBox.checked);
    run.disabled = Boolean(!prepared || prepared.errors.length || !prepared.rows.length || blocked);
  };
  const refreshTarget = async () => {
    const check = (targetCheck += 1);
    target = null;
    replaceBox.checked = false;
    replaceLabel.hidden = true;
    targetLine.textContent = "";
    updateRunState();
    const iso = parseMonthText(month.value);
    if (!iso) return;
    try {
      const found = await inspectImportTarget(context.client.directory, iso);
      if (check !== targetCheck) return;
      target = found;
      targetLine.textContent = TARGET_TEXTS[found.state](formatMonth(iso), found.count);
      targetLine.className = found.state === "rows" || found.state === "closed" ? "target-warning" : "";
      replaceText.textContent = `להחליף את ${found.count} השורות הקיימות בשורות מהקובץ (עותק של הטבלה הישנה יישמר בתיקיית ההצהרה)`;
      replaceLabel.hidden = found.state !== "rows";
      updateRunState();
    } catch (error) {
      if (check === targetCheck) errorLine.textContent = error.message;
    }
  };

  const reset = () => {
    prepared = null;
    file.value = "";
    details.hidden = true;
    errorLine.textContent = "";
    run.disabled = true;
    nextButton.disabled = true;
    resultLine.textContent = "";
    setStep("file");
    closeNow.checked = false;
    target = null;
    targetCheck += 1;
    clientLine.textContent = `לקוח: ${context.client.config.clientName ?? ""}`;
    showCodesState();
  };
  // Tells whether the client has its own classification codes (loaded from its ledger) or the shared defaults are used.
  const showCodesState = async () => {
    const shown = context;
    codesLine.textContent = "";
    try {
      const own = await readClientChart(shown.client.directory);
      if (shown !== context) return;
      codesLine.textContent = own
        ? `קודי המיון של הלקוח נטענו מהכרטסת (${Object.keys(own).length} קודים).`
        : "ללקוח אין עדיין קודי מיון משלו, ויעשה שימוש בקודי ברירת המחדל. מומלץ לטעון קודם את כרטסת קודי המיון של הלקוח.";
    } catch {
      /* the state line is informative only */
    }
  };
  const unknownInputs = () => [...unknownList.querySelectorAll("[data-name]:not([data-known])")].map((row) => ({
    name: row.dataset.name,
    code: row.querySelector("input").value.trim(),
    type: row.querySelector("select").value,
  }));
  // Known names whose chosen type differs from the one this client has now.
  const typeChanges = () => [...unknownList.querySelectorAll("[data-known]")]
    .map((row) => ({ name: row.dataset.name, type: row.querySelector("select").value }))
    .filter(({ name, type }) => prepared.types[name] !== type);
  const chosenTypes = () => Object.fromEntries(
    [...unknownList.querySelectorAll("[data-name]")].map((row) => [row.dataset.name, row.querySelector("select").value]),
  );

  const renderProblems = () => {
    const { errors, warnings } = prepared;
    // Footer mismatches share one line, so the class list below stays in view; warnings go after the list.
    const mismatches = errors.filter((item) => item.code === "footer-mismatch");
    const footerLines = mismatches.length
      ? [
          element(
            "li",
            `שגיאה: סכומי סוף הקובץ אינם תואמים לשורות: ${mismatches.map((item) => `«${FOOTER_LABELS[item.key] ?? item.key}»`).join(", ")}`,
            "problem-error",
          ),
          element("li", "הסכומים תלויים בסוג של כל קוד מיון. בדוק את הסוגים ברשימה למטה; הבדיקה מתעדכנת מיד."),
        ]
      : [];
    const suggested = Object.entries(prepared.suggested);
    const suggestionLines = suggested.length
      ? [element("li", `סוגי הקודים הוגדרו אוטומטית כך שסכומי סוף הקובץ יתאימו: ${suggested.map(([name, type]) => `«${name}» — ${TYPE_LABELS[type]}`).join("; ")}. יש לבדוק לפני המשך.`)]
      : [];
    problems.replaceChildren(
      ...errors
        .filter((item) => item.code !== "footer-mismatch")
        .map((item) => element("li", `שגיאה${item.row ? ` בשורה ${item.row}` : ""}: ${problemText(item)}`, "problem-error")),
      ...footerLines,
      ...suggestionLines,
    );
    warningList.replaceChildren(...warnings.map((item) => element("li", `אזהרה: ${problemText(item)}`)));
    nextButton.disabled = Boolean(prepared.errors.length || !prepared.rows.length);
    updateRunState();
  };
  const typeSelect = (name, value) => {
    const type = element("select");
    for (const option of ACCOUNT_TYPES) type.add(new Option(TYPE_LABELS[option], option));
    type.value = value;
    type.setAttribute("aria-label", `סוג עבור ${name}`);
    type.addEventListener("change", () => {
      prepared.errors = recheckImport(prepared, chosenTypes());
      renderProblems();
    });
    return type;
  };

  const render = () => {
    const { rows, totals, unknown, chart, codes, types } = prepared;
    summary.textContent = `${rows.length} שורות · נטו ${money(totals.net)} · מע״מ נטו ${money(totals.vat)} · ברוטו ${money(totals.gross)}`;
    month.value = formatMonth(prepared.suggestedMonth);
    unknownBox.hidden = !rows.length;
    unknownText.textContent = unknown.length
      ? "קודי המיון בקובץ. לשמות החדשים יש להגדיר קוד וסוג; את הסוג של שם קיים אפשר לשנות ללקוח זה בלבד:"
      : "קודי המיון בקובץ. את הסוג אפשר לשנות ללקוח זה בלבד:";
    const used = { ...context.reserved, ...chart };
    const unknownRows = unknown.map((name) => {
      const row = element("div", undefined, "unknown-account");
      row.dataset.name = name;
      const code = element("input");
      code.value = suggestCode(used);
      used[code.value] = true;
      code.maxLength = 3;
      code.setAttribute("aria-label", `קוד עבור ${name}`);
      row.append(element("strong", name), code, typeSelect(name, prepared.suggested[name] ?? "expense"));
      return row;
    });
    const knownRows = Object.keys(codes).map((name) => {
      const row = element("div", undefined, "unknown-account");
      row.dataset.name = name;
      row.dataset.known = "";
      row.append(element("strong", name), element("span", codes[name]), typeSelect(name, prepared.suggested[name] ?? types[name]));
      return row;
    });
    // Rows whose type was suggested come first and are marked, so the user sees what the file made the app change.
    const listed = [...unknownRows, ...knownRows];
    for (const row of listed) row.classList.toggle("suggested", row.dataset.name in prepared.suggested);
    listed.sort((a, b) => Number(b.classList.contains("suggested")) - Number(a.classList.contains("suggested")));
    unknownList.replaceChildren(...listed);
    prepared.errors = recheckImport(prepared, chosenTypes());
    details.hidden = false;
    renderProblems();
    setStep("check");
    refreshTarget();
  };

  button.addEventListener("click", () => {
    context = getContext();
    if (!context) return onError("יש לבחור תחילה תיקיית נתונים ולקוח לפני ייבוא מ-Excel.");
    reset();
    dialog.showModal();
  });

  codesButton.addEventListener("click", () => onOpenCodes?.());
  nextButton.addEventListener("click", () => setStep("month"));
  backButton.addEventListener("click", () => setStep(dialog.dataset.step === "month" ? "check" : "file"));
  month.addEventListener("input", refreshTarget);
  month.addEventListener("change", refreshTarget);
  replaceBox.addEventListener("change", updateRunState);

  file.addEventListener("change", async () => {
    errorLine.textContent = "";
    details.hidden = true;
    run.disabled = true;
    nextButton.disabled = true;
    setStep("file");
    if (!file.files?.length) return;
    try {
      prepared = await prepareImport(file.files[0], {
        dataRoot: context.dataRoot,
        reserved: context.reserved,
        loadLibrary,
        clientId: context.client.config.clientId,
        clientDirectory: context.client.directory,
      });
      render();
    } catch (error) {
      prepared = null;
      errorLine.textContent = error.message;
    }
  });

  run.addEventListener("click", async () => {
    const iso = parseMonthText(month.value);
    if (!prepared || !iso) {
      errorLine.textContent = "יש להזין חודש הצהרה בפורמט MM/YYYY.";
      return;
    }
    run.disabled = true;
    errorLine.textContent = "";
    try {
      await onBeforeCommit?.(iso);
      const result = await commitImport(prepared, {
        newAccounts: unknownInputs(),
        typeChanges: typeChanges(),
        month: iso,
        closeNow: closeNow.checked,
        replace: replaceBox.checked && target?.state === "rows",
        dataRoot: context.dataRoot,
        client: context.client,
        reserved: context.reserved,
      });
      await onImported(result, iso);
      resultLine.textContent = `יובאו ${prepared.rows.length} שורות להצהרה ${formatMonth(iso)}${closeNow.checked ? " וההצהרה ננעלה" : ""}.`;
      setStep("done");
    } catch (error) {
      errorLine.textContent = error.message;
      refreshTarget();
    }
  });
  // The client's codes changed (ledger loaded): start the wizard over, the file read so far used the old chart.
  return { refreshCodes: () => context && reset() };
}
