// Who a printed buyer is (step 4.6.2): the clients whose own VAT number or confirmed alias proves the buyer of a document. One holder
// is routing proof (add_rows, routed_by alias); none or several is not, and the user is asked.
import { aliasProves } from "../client-alias.js";

// all: the result of services.clients.aliases(). Returns the client ids that hold the buyer.
export function holdersOf(all, buyer) {
  return all
    .filter((client) => aliasProves({ vatId: client.vatId }, buyer) || client.aliases.some((alias) => aliasProves(alias, buyer)))
    .map((client) => client.clientId);
}
