import { useEffect, useState } from "react";

export interface ClubSummary {
  circle_id: number;
  name: string;
  slot_order: number;
  capacity: number;
  in_pool: number;
  rank: number | null;
  rank_diff: number | null;
  fan_count: number | null;
  member_num: number | null;
  comment: string | null;
  tracked_members: number;
  club_daily_avg: number | null;
}

export interface LeaderboardRow {
  friend_viewer_id: number;
  name: string;
  mtd_avg: number;
  mtd_avg_delta: number;
  mtd_cumulative: number;
  fan_gain: number;
  fan_gain_observed: number;
  days_active: number;
  rank_in_club: number;
  rank_overall: number | null;
  leader_chara_id: number | null;
  leader_chara_dress_id: number | null;
  last_login_time: string | null;
}

export interface MemberDay {
  ymd: number;
  circle_id: number;
  fan_count: number;
  fan_gain: number;
  fan_gain_observed: number;
  mtd_cumulative: number;
  days_active: number;
  mtd_avg: number;
  mtd_avg_delta: number;
  rank_in_club: number;
  rank_overall: number | null;
}

export interface Stint {
  circle_id: number;
  club_name: string | null;
  start_ymd: number;
  end_ymd: number | null;
  join_time: string | null;
}

export interface Placement {
  friendViewerId: number;
  name: string;
  rankOverall: number;
  currentCircleId: number;
  projectedCircleId: number | null;
  pinnedAs: "leader" | "manual" | null;
  direction: "up" | "down" | "same";
  gapToNextClub: number | null;
  onBubble: boolean;
  waitlisted: boolean;
  inPool: boolean;
  mtdAvg: number;
  mtdAvgDelta: number;
  daysActive: number;
}

export interface SearchHit {
  friend_viewer_id: number;
  current_name: string;
  matchedAlias: string | null;
  circle_id: number | null;
  leader_chara_id: number | null;
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`/api/${path}`);
  if (!res.ok) throw new Error(`${path} failed: ${res.status}`);
  return (await res.json()) as T;
}

export interface Loadable<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
}

/** Minimal fetch-on-mount hook. The whole site is six read-only endpoints. */
export function useApi<T>(path: string | null): Loadable<T> {
  const [state, setState] = useState<Loadable<T>>({
    data: null,
    error: null,
    loading: path !== null,
  });

  useEffect(() => {
    if (path === null) {
      setState({ data: null, error: null, loading: false });
      return;
    }

    let cancelled = false;
    setState({ data: null, error: null, loading: true });

    get<T>(path)
      .then((data) => {
        if (!cancelled) setState({ data, error: null, loading: false });
      })
      .catch((error: Error) => {
        if (!cancelled) setState({ data: null, error: error.message, loading: false });
      });

    return () => {
      cancelled = true;
    };
  }, [path]);

  return state;
}
