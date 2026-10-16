// Child window that shows the rendered report pages with Close / Save a copy as / Save buttons.
// openReportWindow returns null when the browser blocks the window; the caller then falls back to an inline preview.
const WINDOW_NAME = "reportViewer";
const WINDOW_FEATURES = "popup=yes,width=980,height=900";

const STYLE = `body{margin:0;font-family:"Heebo Variable",Heebo,"Segoe UI",system-ui,Arial,sans-serif;background:#ece9de;color:#3d3929}
.bar{position:sticky;top:0;z-index:2;display:flex;flex-wrap:wrap;gap:10px;align-items:center;padding:10px 16px;background:#fff;border-bottom:1px solid #e0ddd0}
.bar button{padding:7px 16px;border:1px solid #b5542f;border-radius:6px;background:#b5542f;color:#fff;font:inherit;font-weight:600;cursor:pointer}
.bar button:hover{background:#9c4627;border-color:#9c4627}.bar button:focus-visible{outline:none;box-shadow:0 0 0 3px #b5542f47}
.bar button.secondary{background:#fff;border-color:#c9c5b4;color:#3d3929}.bar button.secondary:hover{background:#f5f4ee}.bar button:disabled{opacity:.5;cursor:not-allowed}
.bar .title{flex:1;font-weight:650;color:#141413}.status{flex-basis:100%;padding:8px 12px;border:1px solid #b9d9c6;border-radius:6px;background:#e7f3ec;color:#2f6b4a;font-weight:600}.status:empty{display:none}.status.error{border-color:#efb8b4;background:#fcebea;color:#b3261e}
main{padding:16px}main img{display:block;width:100%;max-width:900px;margin:0 auto 16px;background:#fff;box-shadow:0 1px 6px #14141340}
.message{text-align:center;padding:40px;color:#6b6759}`;

// The new window does not share the page's fonts; link the token sheet by its absolute address when it is known.
function fontLink() {
  try {
    return `<link rel="stylesheet" href="${new URL("tokens.css", globalThis.document.baseURI).href}">`;
  } catch {
    return "";
  }
}

export function openReportWindow({ open = () => window.open("", WINDOW_NAME, WINDOW_FEATURES) } = {}) {
  const win = open();
  if (!win) return null;
  const doc = win.document;
  doc.open();
  doc.write(`<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><title>דוח</title>${fontLink()}<style>${STYLE}</style></head>`
    + `<body><header class="bar"><span class="title" id="title">טוען דוח…</span>`
    + `<button id="save" type="button" disabled>שמירה</button>`
    + `<button id="save-as" type="button" class="secondary" disabled>שמירת העתק בשם…</button>`
    + `<button id="close" type="button" class="secondary">סגירה</button>`
    + `<div class="status" id="status" role="status"></div></header><main id="pages"><p class="message">מכין את הדוח…</p></main></body></html>`);
  doc.close();
  const part = (id) => doc.querySelector(`#${id}`);
  const status = part("status");
  const setStatus = (message, isError = false) => {
    status.textContent = message;
    status.classList.toggle("error", isError);
  };
  part("close").onclick = () => win.close();
  doc.addEventListener("keydown", (event) => { if (event.key === "Escape") win.close(); });
  // Runs a save action and reports its result; the user cancelling the Save As dialog is not an error.
  const guarded = (action) => async () => {
    setStatus("שומר…");
    try {
      setStatus(await action());
    } catch (error) {
      setStatus(error?.name === "AbortError" ? "" : "השמירה נכשלה: " + error.message, error?.name !== "AbortError");
    }
  };
  return {
    win,
    setStatus,
    close: () => win.close(),
    // pageUrls: image URLs of the pages; save() and saveAs(win) resolve to a message shown in the status line.
    show({ title, pageUrls, save, saveAs }) {
      doc.title = title;
      part("title").textContent = title;
      part("pages").replaceChildren(...pageUrls.map((url, index) => {
        const image = doc.createElement("img");
        image.src = url;
        image.alt = `${title} · ${index + 1}`;
        return image;
      }));
      part("save").onclick = guarded(save);
      part("save-as").onclick = guarded(() => saveAs(win));
      part("save").disabled = part("save-as").disabled = false;
    },
    fail(message) {
      part("title").textContent = "הדוח לא נוצר";
      part("pages").replaceChildren();
      setStatus(message, true);
    },
  };
}
