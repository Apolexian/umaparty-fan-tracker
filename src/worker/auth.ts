// Officer authentication.
//
// Members never log in (D012). This covers the officer area only: setting
// leaders, pinning members, the noticeboard, and editing the roster plan.
//
// Workers have no bcrypt or argon2, so passwords use PBKDF2-SHA256 through Web
// Crypto. The iteration count is stored per row so it can be raised later
// without invalidating existing accounts.

import type { Env } from "./types.ts";

/**
 * PBKDF2 rounds.
 *
 * OWASP recommends 210,000 for PBKDF2-SHA256. We cannot use it: that costs
 * ~25ms of CPU and the Workers **free plan caps a request at 10ms**, which is
 * not configurable (`limits.cpu_ms` is rejected with code 100328). At 210k
 * every login died with a raw 1101 exception.
 *
 * 50,000 measures ~5.3ms, leaving headroom for the D1 round-trips in the same
 * request. Exactly one derivation runs per login attempt, including the dummy
 * hash for unknown users, so this is the whole budget.
 *
 * The compensating controls are real: a 12-character minimum, per-user salts,
 * and login rate limiting per ip+username. The exposure if a hash were cracked
 * is edit access to a fan-tracking roster — no payments, no personal data
 * beyond public in-game names.
 *
 * `pw_iters` is stored per row, so raising this later upgrades accounts as
 * their owners change password rather than locking anyone out. If the account
 * ever moves to a paid plan, put it back to 210,000. The stronger fix without
 * paying is client-side stretching (browser derives a key, server hashes that
 * cheaply) — more moving parts than this project currently warrants.
 */
export const PBKDF2_ITERATIONS = 50_000;
const SESSION_DAYS = 30;
const COOKIE_NAME = "umaparty_officer";

/** Failed attempts allowed per ip+username inside the window. */
const RATE_LIMIT = 8;
const RATE_WINDOW_MINUTES = 15;

export interface Officer {
  id: number;
  username: string;
  display_name: string;
  role: string;
}

interface OfficerRow extends Officer {
  pw_hash: string;
  pw_salt: string;
  pw_iters: number;
  is_active: number;
}

// ------------------------------------------------------------- passwords ----

export async function hashPassword(
  password: string,
  saltBytes?: Uint8Array,
  iterations = PBKDF2_ITERATIONS,
): Promise<{ hash: string; salt: string; iterations: number }> {
  // Copied into a fresh Uint8Array so its buffer is a plain ArrayBuffer:
  // deriveBits rejects a view backed by a SharedArrayBuffer.
  const salt = saltBytes
    ? new Uint8Array(saltBytes)
    : crypto.getRandomValues(new Uint8Array(16));

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );

  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    key,
    256,
  );

  return { hash: toBase64(new Uint8Array(bits)), salt: toBase64(salt), iterations };
}

async function verifyPassword(password: string, row: OfficerRow): Promise<boolean> {
  const { hash } = await hashPassword(password, fromBase64(row.pw_salt), row.pw_iters);
  return timingSafeEqual(hash, row.pw_hash);
}

/** Constant-time comparison, so a wrong password cannot be probed byte by byte. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// -------------------------------------------------------------- sessions ----

/**
 * Only the SHA-256 of the session token is stored, so a leaked database dump
 * does not hand over live sessions.
 */
async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return toBase64(new Uint8Array(digest));
}

export async function login(
  env: Env,
  username: string,
  password: string,
  request: Request,
): Promise<{ officer: Officer; cookie: string } | { error: string; status: number }> {
  const ip = request.headers.get("cf-connecting-ip") ?? "unknown";
  const rateKey = `${ip}|${username.toLowerCase()}`;

  if (await isRateLimited(env, rateKey)) {
    return { error: "Too many attempts. Try again in a few minutes.", status: 429 };
  }

  const row = await env.DB.prepare(
    `SELECT id, username, display_name, role, pw_hash, pw_salt, pw_iters, is_active
       FROM officers WHERE username = ?`,
  )
    .bind(username.trim().toLowerCase())
    .first<OfficerRow>();

  // The same failure for an unknown user and a wrong password, so the response
  // does not reveal which usernames exist. The dummy hash keeps the timing
  // comparable too.
  const ok = row && row.is_active === 1 ? await verifyPassword(password, row) : false;
  if (!row) await hashPassword(password);

  await recordAttempt(env, rateKey, ok);

  if (!ok || !row) {
    return { error: "Wrong username or password.", status: 401 };
  }

  const token = toBase64(crypto.getRandomValues(new Uint8Array(32)));
  const expires = new Date(Date.now() + SESSION_DAYS * 86_400_000);

  await env.DB.prepare(
    `INSERT INTO sessions (token_hash, officer_id, created_at, expires_at, user_agent)
     VALUES (?, ?, ?, ?, ?)`,
  )
    .bind(
      await sha256(token),
      row.id,
      new Date().toISOString(),
      expires.toISOString(),
      request.headers.get("user-agent")?.slice(0, 200) ?? null,
    )
    .run();

  await env.DB.prepare("UPDATE officers SET last_login_at = ? WHERE id = ?")
    .bind(new Date().toISOString(), row.id)
    .run();

  return {
    officer: { id: row.id, username: row.username, display_name: row.display_name, role: row.role },
    cookie: buildCookie(token, expires),
  };
}

export async function currentOfficer(env: Env, request: Request): Promise<Officer | null> {
  const token = readCookie(request, COOKIE_NAME);
  if (!token) return null;

  const row = await env.DB.prepare(
    `SELECT o.id, o.username, o.display_name, o.role
       FROM sessions s JOIN officers o ON o.id = s.officer_id
      WHERE s.token_hash = ? AND s.expires_at > ? AND o.is_active = 1`,
  )
    .bind(await sha256(token), new Date().toISOString())
    .first<Officer>();

  return row ?? null;
}

export async function logout(env: Env, request: Request): Promise<string> {
  const token = readCookie(request, COOKIE_NAME);
  if (token) {
    // Revoked server-side, not merely cleared from the browser.
    await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?")
      .bind(await sha256(token))
      .run();
  }
  return `${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
}

function buildCookie(token: string, expires: Date): string {
  return [
    `${COOKIE_NAME}=${token}`,
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
    "Path=/",
    `Expires=${expires.toUTCString()}`,
  ].join("; ");
}

function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return null;
}

// ------------------------------------------------------------ rate limit ----

async function isRateLimited(env: Env, key: string): Promise<boolean> {
  const since = new Date(Date.now() - RATE_WINDOW_MINUTES * 60_000).toISOString();
  const row = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM login_attempts WHERE key = ? AND ok = 0 AND at > ?",
  )
    .bind(key, since)
    .first<{ n: number }>();
  return (row?.n ?? 0) >= RATE_LIMIT;
}

async function recordAttempt(env: Env, key: string, ok: boolean): Promise<void> {
  await env.DB.prepare("INSERT INTO login_attempts (key, at, ok) VALUES (?, ?, ?)")
    .bind(key, new Date().toISOString(), ok ? 1 : 0)
    .run();
}

export async function audit(
  env: Env,
  officerId: number | null,
  action: string,
  detail: unknown,
): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO audit_log (officer_id, action, detail_json, at) VALUES (?, ?, ?, ?)",
  )
    .bind(officerId, action, JSON.stringify(detail ?? null), new Date().toISOString())
    .run();
}

// ----------------------------------------------------------------- utils ----

export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
