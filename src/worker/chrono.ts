// Client for api.chronogenesis.net.
//
// Auth is `Authorization: <raw-token>` with NO `Bearer` prefix — sending
// `Bearer` gets a 403 and omitting the header entirely gets a 422 with an
// unhelpful `{"detail":"Error"}`. A browser User-Agent is also required. (D001)
//
// Never add a call to GET /rotate: the name implies it invalidates the key.

import type { ClubMonthResponse, ClubProfileResponse } from "./types.ts";

const BASE = "https://api.chronogenesis.net";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36";

/** The five clubs, in promotion order. Mirrors the `clubs.slot_order` seed. */
export const CLUBS = [
  { circleId: 665160774, name: "UmaParty", slotOrder: 1 },
  { circleId: 720848953, name: "TwomaParty", slotOrder: 2 },
  { circleId: 928261417, name: "UmaPaThree", slotOrder: 3 },
  { circleId: 201002484, name: "UmaFourty", slotOrder: 4 },
  { circleId: 877539742, name: "カック・サドル", slotOrder: 5 },
] as const;

/** Chrono asks for no more than one request per second; leave headroom. */
export const REQUEST_GAP_MS = 1500;

export class ChronoError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body?: string,
  ) {
    super(message);
    this.name = "ChronoError";
  }
}

export class ChronoClient {
  constructor(private readonly token: string) {}

  private async get<T>(path: string, params: Record<string, string>): Promise<T> {
    const url = new URL(path, BASE);
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }

    const res = await fetch(url, {
      headers: {
        // No "Bearer" — see the note at the top of this file.
        Authorization: this.token,
        "User-Agent": USER_AGENT,
        Accept: "application/json",
      },
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new ChronoError(
        `${path} returned ${res.status}${res.status === 403 ? " (bad token, or a Bearer prefix crept in)" : ""}`,
        res.status,
        body.slice(0, 500),
      );
    }

    return (await res.json()) as T;
  }

  /**
   * Everything for one club, current month: club row, daily and monthly club
   * history, member profiles (including ex-members), and per-member daily
   * history.
   */
  clubProfile(circleId: number): Promise<ClubProfileResponse> {
    return this.get<ClubProfileResponse>("/club_profile", {
      circle_id: String(circleId),
    });
  }

  /**
   * One club's full history for a past month. Used by the backfill and by the
   * month-rollover pass, which re-reads the previous month to lock in its final
   * values before they fall out of `club_profile`'s current-month window.
   *
   * @param sdate first day of the month, "YYYY-MM-01"
   */
  clubMonth(circleId: number, sdate: string): Promise<ClubMonthResponse> {
    return this.get<ClubMonthResponse>("/club_data_by_month", {
      circle_id: String(circleId),
      sdate,
    });
  }
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
