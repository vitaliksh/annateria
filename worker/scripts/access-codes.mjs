// Creates access codes and the token signing key for the Worker (WORK_PLAN step 1.1).
//
//   node scripts/access-codes.mjs <output-folder> <user> [<user> ...]
//
// The codes are printed on this terminal only. The two secret values are written to files in <output-folder>, which must
// be OUTSIDE this repository; load them as Worker secrets and then delete the files:
//
//   Get-Content <folder>\access-codes.json -Raw | npx wrangler secret put ACCESS_CODES
//   Get-Content <folder>\token-signing-key.txt -Raw | npx wrangler secret put TOKEN_SIGNING_KEY
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_ITERATIONS, base64url, generateCode, hashCode } from "../src/access.js";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const [outputArgument, ...users] = process.argv.slice(2);
if (!outputArgument || !users.length || users.some((user) => !/^[a-z][a-z0-9-]{0,30}$/.test(user))) {
  console.error("Usage: node scripts/access-codes.mjs <output-folder-outside-the-repository> <user> [<user> ...]");
  console.error("User names: lower case letters, digits and dashes, starting with a letter.");
  process.exit(2);
}
const output = resolve(outputArgument);
const inside = relative(repositoryRoot, output);
if (inside === "" || (!inside.startsWith("..") && !inside.startsWith(sep) && !/^[a-zA-Z]:/.test(inside))) {
  console.error(`Refusing to write secrets inside the repository (${repositoryRoot}). Choose another folder.`);
  process.exit(2);
}

const entries = {};
const codes = {};
for (const user of users) {
  codes[user] = generateCode();
  entries[user] = await hashCode(codes[user], { iterations: DEFAULT_ITERATIONS });
}
mkdirSync(output, { recursive: true });
try {
  writeFileSync(join(output, "access-codes.json"), JSON.stringify(entries), { flag: "wx" });
  writeFileSync(join(output, "token-signing-key.txt"), base64url(crypto.getRandomValues(new Uint8Array(32))), { flag: "wx" });
} catch (error) {
  console.error(error.code === "EEXIST" ? `Files already exist in ${output}; nothing was overwritten. Delete them or use another folder.` : error.message);
  process.exit(1);
}

console.log(`Written to ${output}: access-codes.json, token-signing-key.txt (load them as Worker secrets, then delete them).`);
console.log("Access codes (show each person only their own, do not store them in a file):");
for (const [user, code] of Object.entries(codes)) console.log(`  ${user.padEnd(12)} ${code}`);
