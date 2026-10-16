import test from "node:test";
import assert from "node:assert/strict";
import { isHomeUtility } from "../home-utilities.js";

test("the accounts and documents of Anna's list are home utilities", () => {
  for (const accountName of ["חשמל", "מים", "ביוב", "ארנונה", "חשמל ומים", "מים וביוב", "ארנונה ומים"])
    assert.equal(isHomeUtility({ accountName }), true, accountName);
  for (const text of ["חשבון חשמל", "חשבון המים", "ארנונה לתקופה 07-08", "תשלום ביוב", "דמי מים"])
    assert.equal(isHomeUtility({ accountName: "אחזקה", texts: [text] }), true, text);
});

test("the built-in account of property tax keeps its old 25%", () => {
  assert.equal(isHomeUtility({ accountName: "מסים ואגרות" }), true);
});

test("other accounts and documents are not home utilities", () => {
  assert.equal(isHomeUtility({ accountName: "דלק", texts: ["תדלוק"] }), false);
  assert.equal(isHomeUtility({ accountName: "הוצאות משרדיות", texts: ["מימון", "תמים", "מסמכים"] }), false);
  assert.equal(isHomeUtility({}), false);
  assert.equal(isHomeUtility({ accountName: null, texts: [null, undefined] }), false);
});
