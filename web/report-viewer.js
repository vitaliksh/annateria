// The report on screen: a dialog inside the page, modal, so the work behind it cannot be touched until it is closed (the owner,
// 10 November 2026: a separate browser window stayed open beside the work). It shows the pages (A4 images) or a saved PDF, and has
// Print, Save (into the client's reports folder, never a folder picked at random) and Close.
const STYLE_ID = "report-dialog-style";
const STYLE = `#report-dialog{width:min(980px,96vw);height:94vh;max-height:94vh;padding:0;border:0;border-radius:10px;overflow:hidden}
#report-dialog::backdrop{background:#14141399}
#report-dialog .report-frame{display:flex;flex-direction:column;height:100%}
#report-dialog .bar{display:flex;flex-wrap:wrap;gap:10px;align-items:center;padding:10px 16px;background:#fff;border-bottom:1px solid #e0ddd0}
#report-dialog .title{flex:1;font-weight:650}
#report-dialog .status{flex-basis:100%;padding:8px 12px;border:1px solid #b9d9c6;border-radius:6px;background:#e7f3ec;color:#2f6b4a;font-weight:600}
#report-dialog .status:empty{display:none}#report-dialog .status.error{border-color:#efb8b4;background:#fcebea;color:#b3261e}
#report-dialog .pages{flex:1;overflow:auto;padding:16px;background:#ece9de}
#report-dialog .pages img{display:block;width:100%;max-width:900px;margin:0 auto 16px;background:#fff;box-shadow:0 1px 6px #14141340}
#report-dialog .pages iframe{width:100%;height:100%;border:0;background:#fff}
#report-dialog .message{text-align:center;padding:40px;color:#6b6759}
@page{size:A4;margin:0}
@media print{body:has(#report-dialog[open])>*:not(#report-dialog){display:none!important}
#report-dialog[open]{position:static;width:auto;height:auto;max-height:none;border-radius:0;overflow:visible}
#report-dialog::backdrop{background:none}#report-dialog .bar{display:none}#report-dialog .pages{padding:0;background:#fff;overflow:visible}
#report-dialog .pages img{width:210mm;height:297mm;max-width:none;margin:0;box-shadow:none;break-after:page}
#report-dialog .pages img:last-child{break-after:auto}}`;

function ensureDialog(doc) {
  if (!doc.getElementById(STYLE_ID)) doc.head.append(Object.assign(doc.createElement("style"), { id: STYLE_ID, textContent: STYLE }));
  let dialog = doc.getElementById("report-dialog");
  if (dialog) return dialog;
  dialog = doc.createElement("dialog");
  dialog.id = "report-dialog";
  dialog.setAttribute("aria-labelledby", "report-dialog-title");
  dialog.innerHTML = `<div class="report-frame"><header class="bar"><span class="title" id="report-dialog-title">טוען דוח…</span>`
    + `<button id="report-dialog-print" type="button" disabled>הדפסה</button>`
    + `<button id="report-save" type="button" class="secondary" disabled>שמירה בתיקיית הלקוח</button>`
    + `<button id="report-close" type="button" class="secondary">סגירה</button>`
    + `<div class="status" id="report-status" role="status"></div></header><div class="pages" id="report-pages"></div></div>`;
  doc.body.append(dialog);
  return dialog;
}

// Opens the dialog at once (the work behind it is locked) and returns { show, showPdf, fail, setStatus, close }.
export function openReportWindow({ document: doc = globalThis.document } = {}) {
  const dialog = ensureDialog(doc);
  const part = (id) => dialog.querySelector(`#${id}`);
  const status = part("report-status");
  const setStatus = (message, isError = false) => {
    status.textContent = message;
    status.classList.toggle("error", isError);
  };
  const urls = [];
  const close = () => {
    if (dialog.open) dialog.close();
    for (const url of urls.splice(0)) URL.revokeObjectURL?.(url);
  };
  part("report-dialog-title").textContent = "טוען דוח…";
  part("report-pages").replaceChildren(Object.assign(doc.createElement("p"), { className: "message", textContent: "מכין את הדוח…" }));
  part("report-dialog-print").disabled = part("report-save").disabled = true;
  part("report-save").hidden = false;
  setStatus("");
  part("report-close").onclick = close;
  if (typeof dialog.showModal === "function" && !dialog.open) dialog.showModal();
  else dialog.open = true;

  const guarded = (action) => async () => {
    setStatus("שומר…");
    try {
      setStatus(await action());
    } catch (error) {
      setStatus(`השמירה נכשלה: ${error.message}`, true);
    }
  };
  const printWhenReady = (images) => Promise.all(images.map((image) => (image.complete ? null : new Promise((done) => { image.onload = image.onerror = done; }))))
    .then(() => doc.defaultView?.print?.());

  return {
    setStatus,
    close,
    // pageUrls: the A4 images of the report. save() resolves with the message of where it went. print: the print dialog opens at once.
    // notice: a line shown at the top (a report of this period saved before).
    show({ title, pageUrls, save, print = false, notice = "" }) {
      part("report-dialog-title").textContent = title;
      urls.push(...pageUrls);
      const images = pageUrls.map((url, index) => Object.assign(doc.createElement("img"), { src: url, alt: `${title} · ${index + 1}` }));
      part("report-pages").replaceChildren(...images);
      part("report-dialog-print").onclick = () => doc.defaultView?.print?.();
      part("report-save").onclick = guarded(save);
      part("report-dialog-print").disabled = part("report-save").disabled = false;
      if (notice) setStatus(notice);
      if (print) printWhenReady(images);
    },
    // A report saved before: the PDF itself, printed from its own frame.
    showPdf({ title, url }) {
      part("report-dialog-title").textContent = title;
      urls.push(url);
      const frame = Object.assign(doc.createElement("iframe"), { src: url, title });
      part("report-pages").replaceChildren(frame);
      part("report-save").hidden = true;
      part("report-dialog-print").onclick = () => frame.contentWindow?.print?.();
      part("report-dialog-print").disabled = false;
    },
    fail(message) {
      part("report-dialog-title").textContent = "הדוח לא נוצר";
      part("report-pages").replaceChildren();
      setStatus(message, true);
    },
  };
}
