import { describe, expect, it } from "vitest";

import { payloadMonth, startYmdFor, ymdOf } from "../src/worker/ingest.ts";

describe("ymdOf", () => {
  it("uses UTC, since chrono's data day is UTC-based", () => {
    // 23:30 UTC on the 6th is still the 6th, even where the local date differs.
    expect(ymdOf(new Date("2026-08-06T23:30:00Z"))).toBe(20260806);
    expect(ymdOf(new Date("2026-08-07T00:10:00Z"))).toBe(20260807);
  });

  it("zero-pads months and days", () => {
    expect(ymdOf(new Date("2026-01-05T12:00:00Z"))).toBe(20260105);
  });
});

describe("startYmdFor", () => {
  it("prefers the API's join_time over the day we first noticed", () => {
    // On the first ever ingest every member looks new. Dating all 147 stints
    // to deploy day would discard history the API is handing us.
    expect(startYmdFor("2026-08-02T12:25:22", 20260807)).toBe(20260802);
  });

  it("falls back to the observed day when join_time is missing", () => {
    expect(startYmdFor(null, 20260807)).toBe(20260807);
  });

  it("falls back when join_time does not parse", () => {
    expect(startYmdFor("not a date", 20260807)).toBe(20260807);
  });

  it("ignores a join_time in the future", () => {
    // Clock skew between chrono and us must not produce a stint that starts
    // after the day it was observed.
    expect(startYmdFor("2026-09-01T00:00:00", 20260807)).toBe(20260807);
  });

  it("accepts a join_time from a previous month", () => {
    expect(startYmdFor("2025-06-26T12:31:49", 20260807)).toBe(20250626);
  });

  it("treats join_time as UTC", () => {
    // chrono returns naive timestamps; they are read as UTC, not local.
    expect(startYmdFor("2026-08-02T23:59:00", 20260807)).toBe(20260802);
  });
});

describe("payloadMonth — which month the payload covers (D033)", () => {
  it("takes the month from chrono, not from the clock", () => {
    // The 10:15 run on 1 September: chrono has rolled its month_filter over,
    // so the payload is September's even though it is nearly empty.
    const profile = { month_filter: [{ sdate: "2026-09-01" }, { sdate: "2026-08-01" }] };

    expect(payloadMonth(profile, new Date("2026-09-01T10:15:00Z"))).toEqual({
      year: 2026,
      month: 9,
    });
  });

  it("keeps last month when chrono has not rolled over yet", () => {
    // The case that duplicated August into September: it is the 1st by the
    // clock, but chrono is still serving August. Dating this by `now` rewrote
    // the whole month one month forward.
    const profile = { month_filter: [{ sdate: "2026-08-01" }, { sdate: "2026-07-01" }] };

    expect(payloadMonth(profile, new Date("2026-09-01T10:15:00Z"))).toEqual({
      year: 2026,
      month: 8,
    });
  });

  it("falls back to the clock when month_filter is missing", () => {
    expect(payloadMonth({}, new Date("2026-09-04T10:15:00Z"))).toEqual({
      year: 2026,
      month: 9,
    });
  });
});
