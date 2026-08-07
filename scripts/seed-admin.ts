// Create the first officer account.
//
//   npm run seed-admin -- --username ivan --password '...' --name Ivan
//   npm run seed-admin -- --remote --username ivan --password '...'
//
// There is no self-signup: this bootstraps the first admin, who then creates
// everyone else in the admin area (D012).
//
// Stop `wrangler dev` first — it holds a lock on the local D1 file.

import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { webcrypto } from "node:crypto";

// hashPassword uses Web Crypto, which is global in Workers but needs assigning
// here so the same code produces the same hash in both places.
globalThis.crypto ??= webcrypto as unknown as Crypto;

const { hashPassword, PBKDF2_ITERATIONS } = await import("../src/worker/auth.ts");

const WRANGLER = join(process.cwd(), "node_modules", "wrangler", "bin", "wrangler.js");
const args = process.argv.slice(2);

function flag(name: string): string | undefined {
  const index = args.indexOf(`--${name}`);
  return index === -1 ? undefined : args[index + 1];
}

const remote = args.includes("--remote");
const username = flag("username");
const password = flag("password");
const displayName = flag("name") ?? username;
const role = flag("role") ?? "admin";

if (!username || !password) {
  console.error(
    "Usage: npm run seed-admin -- --username <name> --password <password> [--name <display>] [--remote]",
  );
  process.exit(1);
}

if (password.length < 12) {
  console.error("Password must be at least 12 characters.");
  process.exit(1);
}

const { hash, salt, iterations } = await hashPassword(password);

const sql = `INSERT INTO officers (username, display_name, pw_hash, pw_salt, pw_iters, role, is_active, created_at)
VALUES ('${escape(username.trim().toLowerCase())}', '${escape(displayName!)}', '${hash}', '${salt}', ${iterations}, '${role === "admin" ? "admin" : "officer"}', 1, '${new Date().toISOString()}')
ON CONFLICT (username) DO UPDATE SET
  pw_hash = excluded.pw_hash,
  pw_salt = excluded.pw_salt,
  pw_iters = excluded.pw_iters,
  role = excluded.role,
  is_active = 1;`;

const dir = mkdtempSync(join(tmpdir(), "umaparty-seed-"));
const file = join(dir, "seed.sql");
writeFileSync(file, sql, "utf8");

execFileSync(
  process.execPath,
  [
    WRANGLER,
    "d1",
    "execute",
    "umaparty",
    remote ? "--remote" : "--local",
    "--yes",
    `--file=${file}`,
  ],
  { stdio: ["ignore", "ignore", "inherit"] },
);

console.log(
  `\nOfficer "${username}" created on the ${remote ? "REMOTE" : "local"} database (${role}, PBKDF2 x${PBKDF2_ITERATIONS}).`,
);
console.log("Sign in at /officers.");

function escape(value: string): string {
  return value.replaceAll("'", "''");
}
