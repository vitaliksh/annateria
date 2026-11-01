// The dialog "choose a client and a month" (#month-choice-dialog, step 9.5): the inbox belongs to one month of one client, so a way
// into it from outside a month asks for them first. Lists the active clients of the data root that have months, and the months of
// the chosen client, newest first. Pure DOM; dialogResult does the accept and cancel.
import { dialogResult } from "./confirm-dialog.js";
import { formatMonth } from "./month-format.js";

// getClients(): the active clients ({ id, clientName, parent, declarations: [{ declaration }] }); getCurrentClientId(): the client
// to offer first. choose() resolves with { clientId, month } or null (cancelled, or no client has a month: onEmpty() is called).
export function setupMonthChoice({ dialog, getClients, getCurrentClientId = () => null, onEmpty = () => {} }) {
  const doc = dialog.ownerDocument;
  const [clientSelect, monthSelect, accept] = ["month-choice-client", "month-choice-month", "month-choice-accept"].map((id) => dialog.querySelector(`#${id}`));
  const option = (value, text) => Object.assign(doc.createElement("option"), { value, textContent: text });
  const monthsOf = (client) => (client?.declarations ?? []).map((entry) => entry.declaration).filter((declaration) => !declaration.archived)
    .map((declaration) => declaration.month).sort().reverse();
  const choices = () => (getClients() ?? []).filter((client) => client.parent && monthsOf(client).length);
  const fillMonths = () => {
    const client = choices().find((item) => item.id === clientSelect.value);
    monthSelect.replaceChildren(...monthsOf(client).map((month) => option(month, formatMonth(month))));
  };
  clientSelect.addEventListener("change", fillMonths);

  async function choose() {
    const clients = choices();
    if (!clients.length) {
      onEmpty();
      return null;
    }
    clientSelect.replaceChildren(...clients.map((client) => option(client.id, client.clientName)));
    const current = getCurrentClientId();
    clientSelect.value = clients.some((client) => client.id === current) ? current : clients[0].id;
    fillMonths();
    return dialogResult(dialog, { accept, getValue: () => ({ clientId: clientSelect.value, month: monthSelect.value }) });
  }

  return { choose };
}
