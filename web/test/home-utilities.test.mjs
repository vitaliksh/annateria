import test from "node:test";
import assert from "node:assert/strict";
import { isHomeUtility, isLimitedVat } from "../home-utilities.js";

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

test("two thirds of the VAT: built-in codes, and a client's own vehicle, fuel and mobile accounts by name", () => {
  for (const account of ["806", "807", "812"]) assert.equal(isLimitedVat({ account }), true, account);
  for (const accountName of ["דלק", "רכב ללא דלק", "הוצאות רכב", "דלק רכב 19-466-604", "טלפון סלולרי", "טלפון נייד"]) {
    assert.equal(isLimitedVat({ account: "228", accountName }), true, accountName);
  }
  for (const accountName of ["אחזקה", "טלפון", "אינטרנט", "כיבוד", "רכבת", "ציוד ספורט מתכלה", ""]) {
    assert.equal(isLimitedVat({ account: "203", accountName }), false, accountName);
  }
});

test("goods named after electricity are not a home utility; an electricity bill still is; parking takes two thirds of the VAT", () => {
  assert.equal(isHomeUtility({ accountName: "אחזקה", texts: ["מוצרי חשמל", "חשבונית מס"] }), false);
  assert.equal(isHomeUtility({ accountName: "אחזקה", texts: ["כלי חשמל לבית"] }), false);
  assert.equal(isHomeUtility({ accountName: "אחזקה", texts: ["חשבון חשמל תקופתי"] }), true);
  assert.equal(isHomeUtility({ accountName: "חשמל", texts: ["מוצרי חשמל"] }), true, "the account of the chart still decides");
  assert.equal(isLimitedVat({ account: "234", accountName: "חניה פנגו" }), true);
});
