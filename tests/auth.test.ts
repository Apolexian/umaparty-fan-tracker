import { describe, expect, it } from "vitest";

import { fromBase64, hashPassword, PBKDF2_ITERATIONS, toBase64 } from "../src/worker/auth.ts";

// Each hash is 210k PBKDF2 rounds and several tests derive more than one, so
// these are CPU-bound rather than slow for any interesting reason. The default
// 5s timeout flakes on a loaded machine or a shared CI runner; observed once
// here while a backfill was saturating the box.
const CPU_BOUND = 30_000;

describe("base64 helpers", () => {
  it("round-trips arbitrary bytes", () => {
    const bytes = new Uint8Array([0, 1, 127, 128, 255, 42]);
    expect([...fromBase64(toBase64(bytes))]).toEqual([...bytes]);
  });
});

describe("hashPassword", () => {
  it("derives a stable hash for the same password and salt", async () => {
    const first = await hashPassword("correct horse battery staple");
    const second = await hashPassword(
      "correct horse battery staple",
      fromBase64(first.salt),
      first.iterations,
    );
    expect(second.hash).toBe(first.hash);
  }, CPU_BOUND);

  it("derives a different hash for a different password", async () => {
    const first = await hashPassword("correct horse battery staple");
    const second = await hashPassword("Correct horse battery staple", fromBase64(first.salt));
    expect(second.hash).not.toBe(first.hash);
  }, CPU_BOUND);

  it("salts each account separately", async () => {
    // Two officers with the same password must not share a hash, or one
    // cracked password reveals the other.
    const a = await hashPassword("the same password");
    const b = await hashPassword("the same password");
    expect(a.salt).not.toBe(b.salt);
    expect(a.hash).not.toBe(b.hash);
  }, CPU_BOUND);

  it("records the iteration count used, so it can be raised later", async () => {
    const weak = await hashPassword("pw", undefined, 1000);
    expect(weak.iterations).toBe(1000);

    const current = await hashPassword("pw");
    expect(current.iterations).toBe(PBKDF2_ITERATIONS);

    // A stored row hashed at the old count must still verify at that count.
    const replay = await hashPassword("pw", fromBase64(weak.salt), weak.iterations);
    expect(replay.hash).toBe(weak.hash);
  }, CPU_BOUND);

  it("uses a non-trivial iteration count by default", async () => {
    expect(PBKDF2_ITERATIONS).toBeGreaterThanOrEqual(210_000);
  });

  it("produces a 256-bit hash and 128-bit salt", async () => {
    const { hash, salt } = await hashPassword("pw");
    expect(fromBase64(hash)).toHaveLength(32);
    expect(fromBase64(salt)).toHaveLength(16);
  }, CPU_BOUND);
});
