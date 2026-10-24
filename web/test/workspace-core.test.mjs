import test from "node:test";
import assert from "node:assert/strict";
import { REPORT_PERIODS, checkClientRename, normalizeClientTaxProfile, normalizeWorkspaceConfig, taxIdProblem } from "../workspace-core.js";

test("нормализует корректную конфигурацию клиента", () => {
  const result = normalizeWorkspaceConfig({ clientId: "id", clientName: " Клиент ", businessActivity: " Спорт ", businessKind: "home" });
  assert.deepEqual(result, { valid: true, config: { schemaVersion: 1, clientId: "id", clientName: "Клиент", businessActivity: "Спорт", businessKind: "home", archived: false } });
});

test("отклоняет конфигурацию без обязательных данных", () => {
  assert.equal(normalizeWorkspaceConfig({ clientName: "Клиент", businessActivity: "", businessKind: "home" }).valid, false);
  assert.equal(normalizeWorkspaceConfig({ clientName: "Клиент", businessActivity: "Спорт", businessKind: "invalid" }).valid, false);
});

test("свойства клиента хранят периоды НДС и авансов независимо; неверные значения отбрасываются", () => {
  const base = { clientId: "id", clientName: "Клиент", businessActivity: "Спорт", businessKind: "home" };
  assert.deepEqual(REPORT_PERIODS, ["monthly", "bimonthly"]);
  const both = normalizeWorkspaceConfig({ ...base, vatPeriod: "bimonthly", advancesPeriod: "monthly" }).config;
  assert.deepEqual([both.vatPeriod, both.advancesPeriod], ["bimonthly", "monthly"]);
  const wrong = normalizeWorkspaceConfig({ ...base, vatPeriod: "weekly", advancesPeriod: 2 }).config;
  assert.deepEqual(Object.keys(wrong).filter((key) => key.endsWith("Period")), []);
  const kept = normalizeWorkspaceConfig({ ...both, clientName: "Другое имя" }).config;
  assert.deepEqual([kept.vatPeriod, kept.advancesPeriod], ["bimonthly", "monthly"]);
});

test("налоговый профиль клиента: номера, флаг PCN; пустое не сохраняется, старые файлы читаются как раньше", () => {
  const base = { clientId: "id", clientName: "Клиент", businessActivity: "Спорт", businessKind: "home" };
  assert.deepEqual(normalizeClientTaxProfile({ vatId: " 123456782 ", incomeTaxFileId: "", pcnRequired: true }), { vatId: "123456782", pcnRequired: true });
  assert.deepEqual(normalizeClientTaxProfile({ pcnRequired: "yes" }), {});
  assert.deepEqual(normalizeClientTaxProfile(undefined), {});
  const config = normalizeWorkspaceConfig({ ...base, vatId: "123456782", incomeTaxFileId: "987654321", pcnRequired: true }).config;
  assert.equal(config.vatId, "123456782"); assert.equal(config.incomeTaxFileId, "987654321"); assert.equal(config.pcnRequired, true);
  const old = normalizeWorkspaceConfig(base).config;
  assert.equal("vatId" in old, false); assert.equal("pcnRequired" in old, false);
});

test("the business address of the tax profile: one trimmed line of at most 200 characters, left out when empty", () => {
  const base = { clientId: "id", clientName: "Клиент", businessActivity: "Спорт", businessKind: "home" };
  assert.deepEqual(normalizeClientTaxProfile({ address: "  Herzl 1\n  Tel Aviv " }), { address: "Herzl 1 Tel Aviv" });
  assert.equal(normalizeClientTaxProfile({ address: "x".repeat(250) }).address.length, 200);
  assert.deepEqual(normalizeClientTaxProfile({ address: "   " }), {});
  assert.equal(normalizeWorkspaceConfig({ ...base, address: "Herzl 1" }).config.address, "Herzl 1");
  assert.equal("address" in normalizeWorkspaceConfig(base).config, false);
});

test("мягкая проверка налогового номера: 9 цифр и контрольная цифра", () => {
  assert.equal(taxIdProblem(""), "");
  assert.equal(taxIdProblem("123456782", { checkDigit: true }), "");
  assert.notEqual(taxIdProblem("123456783", { checkDigit: true }), "");
  assert.equal(taxIdProblem("123456783"), "");
  assert.notEqual(taxIdProblem("12345"), "");
  assert.notEqual(taxIdProblem("12345678a"), "");
});

test("rename of a client: trimmed, not empty, not the name of another client; the own name may be kept", () => {
  const clients = [{ id: "a", clientName: "Levi Plumbing" }, { id: "b", clientName: "Cohen" }];
  assert.deepEqual(checkClientRename("  Levi   Plumbing Ltd ", clients, "a"), { valid: true, clientName: "Levi Plumbing Ltd" });
  assert.deepEqual(checkClientRename("levi plumbing", clients, "a"), { valid: true, clientName: "levi plumbing" }, "the own name, other case");
  assert.equal(checkClientRename("   ", clients, "a").valid, false);
  assert.equal(checkClientRename("COHEN", clients, "a").valid, false);
  assert.equal(checkClientRename(undefined, clients, "a").valid, false);
});
