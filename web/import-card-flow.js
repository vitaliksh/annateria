// How the wizard opened from an import card ended, told back to the card (docs/UI_REDESIGN_PROPOSAL.md, C1). Without it the card
// kept "האשף נפתח." after the wizard was closed half-way, and nothing said that the month was not imported (owner, 30 October 2026).
export const NOT_IMPORTED = "לא יובא: האשף נסגר לפני הסוף. הקובץ נשאר בתיבת הקלט.";
export const NOT_ADDED = "לא נוסף: ההוספה בוטלה. הקובץ נשאר בתיבת הקלט.";

// dialog: the wizard's <dialog>, or null for the income report, whose confirmation ends when its openWith resolves.
// report({ text, state }) is the card's report. committed() is called when the wizard wrote; opened() after openWith resolved.
export function watchWizard({ dialog = null, report }) {
  let committed = false;
  let closed = false;
  const onClose = () => {
    closed = true;
    if (!committed) report({ text: dialog ? NOT_IMPORTED : NOT_ADDED, state: "unfinished" });
  };
  dialog?.addEventListener("close", onClose, { once: true });
  return {
    committed: () => { committed = true; },
    opened() {
      if (!dialog) return onClose();
      // The wizard refused to open (the page said why): its next close belongs to another card.
      if (!dialog.open && !closed) dialog.removeEventListener("close", onClose);
    },
  };
}
