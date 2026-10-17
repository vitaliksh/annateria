// A confirmed alias of a client (step 4.6.2): the buyer printed on documents (VAT number and/or name) that the user once confirmed
// as this client. The rule of proof: when the document prints the buyer's VAT number, only the number counts; otherwise the name,
// compared exactly after normalising (nameTokens: case, quotes, legal suffixes). Pure: shared by the tools, the store and the page.
import { nameTokens } from "./intake-facts.js";

const NAME_CHARS = 120;
export const aliasDigits = (value) => String(value ?? "").replace(/\D/g, "").replace(/^0+/, "");
export const aliasName = (value) => nameTokens(value).join(" ");
const printed = (value) => String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, NAME_CHARS);

// The buyer of a fact record: { vatId, name } as printed (cleaned), or null when neither is there.
export function buyerOf(record) {
  const vatId = aliasDigits(record?.buyer_vat_id);
  const name = aliasName(record?.buyer_name) ? printed(record.buyer_name) : "";
  return vatId || name ? { vatId, name } : null;
}

// Two buyers are the same when their numbers are equal and their names are equal after normalising.
export function sameBuyer(a, b) {
  return aliasDigits(a?.vatId) === aliasDigits(b?.vatId) && aliasName(a?.name) === aliasName(b?.name);
}

// Whether two printed buyers are one for the proof: equal numbers when either prints one, otherwise equal names.
export function provesSame(a, b) {
  const [first, second] = [aliasDigits(a?.vatId), aliasDigits(b?.vatId)];
  if (first || second) return first === second;
  return Boolean(aliasName(a?.name)) && aliasName(a?.name) === aliasName(b?.name);
}

// Whether an alias (or a client's own VAT number as { vatId }) proves the buyer.
export function aliasProves(alias, buyer) {
  if (!buyer) return false;
  const vatId = aliasDigits(buyer.vatId);
  if (vatId) return aliasDigits(alias?.vatId) === vatId;
  const name = aliasName(buyer.name);
  return Boolean(name && aliasName(alias?.name) === name);
}
