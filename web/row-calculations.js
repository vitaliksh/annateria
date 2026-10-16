function amount(value) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : 0; }
function round(value) { return Math.round((value + Number.EPSILON) * 100) / 100; }

// The source amounts stay untouched on the row. Expense recognition controls
// the VAT-inclusive journal amount; VAT recognition independently controls the
// deductible VAT. Non-deductible VAT stays in the recognised expense.
export function recognisedAmounts(rawNet, rawVat, recognisedPercent = 100, vatRecognisedPercent = 100) {
  const sourceNet = amount(rawNet), sourceVat = amount(rawVat), sourceGross = sourceNet + sourceVat;
  const expensePercent = Math.max(0, Math.min(100, amount(recognisedPercent))) / 100;
  const vatPercent = Math.max(0, Math.min(100, amount(vatRecognisedPercent))) / 100;
  const gross = round(sourceGross * expensePercent);
  if (!sourceVat) return { gross: gross.toFixed(2), net: gross.toFixed(2), vat: "0.00" };
  const vat = round(sourceVat * Math.min(expensePercent, vatPercent));
  const net = round(gross - vat);
  return { gross: gross.toFixed(2), net: net.toFixed(2), vat: vat.toFixed(2) };
}

export function sourceAmountsFromGross(grossValue, vatPercent = 18) {
  const gross = round(amount(grossValue)), rate = Math.max(0, amount(vatPercent)) / 100;
  if (!rate) return { gross: gross.toFixed(2), net: gross.toFixed(2), vat: "0.00" };
  const net = round(gross / (1 + rate));
  return { gross: gross.toFixed(2), net: net.toFixed(2), vat: round(gross - net).toFixed(2) };
}

export function sourceAmountsFromNet(netValue, vatPercent = 18) {
  const net = round(amount(netValue)), rate = Math.max(0, amount(vatPercent)) / 100, vat = round(net * rate);
  return { gross: round(net + vat).toFixed(2), net: net.toFixed(2), vat: vat.toFixed(2) };
}

// The user types the VAT of the document: the total stays, the rest is the net and the rate follows the VAT.
export function sourceAmountsFromVat(vatValue, grossValue) {
  const gross = round(amount(grossValue)), vat = round(amount(vatValue));
  if (vat > gross) return null;
  const net = round(gross - vat);
  return { gross: gross.toFixed(2), net: net.toFixed(2), vat: vat.toFixed(2), percent: net > 0 ? round((vat / net) * 100) : 0 };
}
