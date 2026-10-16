import assert from "node:assert/strict";
import test from "node:test";
import { DeviceRegistry } from "../src/index.js";

const credentialId = "credential-id-that-is-long-enough";

function storage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    async get(key) { return values.get(key); },
    async put(key, value) { values.set(key, value); },
    async delete(key) { values.delete(key); },
    values,
  };
}

function registry(initial, api) {
  const durableStorage = storage(initial);
  return { durableStorage, subject: new DeviceRegistry({ storage: durableStorage }, undefined, api) };
}

async function body(response) { return response.json(); }

test("stores a verified registration without private material", async () => {
  const api = {
    async verifyRegistrationResponse() {
      return { verified: true, registrationInfo: { credential: { id: credentialId, publicKey: new Uint8Array([1, 2, 3]), counter: 0, transports: ["internal"] }, credentialDeviceType: "singleDevice", credentialBackedUp: false } };
    },
  };
  const { durableStorage, subject } = registry({ registration: { challenge: "challenge", expiresAt: Date.now() + 1_000 } }, api);
  const response = await subject.finishRegistration({ response: "attestation" });
  assert.equal(response.status, 200);
  assert.equal((await body(response)).credentialId, credentialId);
  assert.deepEqual(await durableStorage.get(`credential:${credentialId}`), { id: credentialId, publicKey: new Uint8Array([1, 2, 3]), counter: 0, transports: ["internal"], deviceType: "singleDevice", backedUp: false, createdAt: (await durableStorage.get(`credential:${credentialId}`)).createdAt });
  assert.equal(await durableStorage.get("registration"), undefined);
});

test("rejects an expired registration challenge", async () => {
  const { subject } = registry({ registration: { challenge: "old", expiresAt: Date.now() - 1 } }, {});
  const response = await subject.finishRegistration({});
  assert.equal(response.status, 401);
});

test("updates the signature counter and issues a short-lived grant after verified authentication", async () => {
  const api = {
    async verifyAuthenticationResponse(input) {
      assert.equal(input.expectedChallenge, "challenge");
      assert.equal(input.requireUserVerification, true);
      return { verified: true, authenticationInfo: { newCounter: 7 } };
    },
  };
  const credential = { id: credentialId, publicKey: new Uint8Array([1]), counter: 2, transports: ["internal"] };
  const { durableStorage, subject } = registry({ [`credential:${credentialId}`]: credential, [`authentication:${credentialId}`]: { challenge: "challenge", expiresAt: Date.now() + 1_000 } }, api);
  const response = await subject.finishAuthentication({ credentialId, response: "assertion" });
  assert.equal(response.status, 200);
  const grant = await body(response);
  assert.equal(grant.ok, true);
  assert.equal((await durableStorage.get(`credential:${credentialId}`)).counter, 7);
  assert.equal(await durableStorage.get(`authentication:${credentialId}`), undefined);
  assert.equal((await subject.authorize({ credentialId, token: grant.token })).status, 200);
});

test("rejects invalid authentication signatures without issuing a grant", async () => {
  const api = { async verifyAuthenticationResponse() { throw new Error("invalid signature"); } };
  const { durableStorage, subject } = registry({ [`credential:${credentialId}`]: { id: credentialId }, [`authentication:${credentialId}`]: { challenge: "challenge", expiresAt: Date.now() + 1_000 } }, api);
  const response = await subject.fetch(new Request("https://passkeys/finish-authentication", { method: "POST", body: JSON.stringify({ credentialId, response: "bad" }) }));
  assert.equal(response.status, 400);
  assert.equal(await durableStorage.get(`token:${credentialId}`), undefined);
});

test("rejects expired grants", async () => {
  const { subject } = registry({ [`token:${credentialId}`]: { token: "token", expiresAt: Date.now() - 1 } }, {});
  assert.equal((await subject.authorize({ credentialId, token: "token" })).status, 401);
});
