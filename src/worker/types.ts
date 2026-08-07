// Shapes returned by api.chronogenesis.net, transcribed from its public
// /openapi.json. Only the fields this project uses are typed.

export interface ClubOut {
  circle_id: number;
  leader_viewer_id: number;
  name: string;
  comment: string;
  member_num: number;
  join_style: number;
  policy: number;
  make_time: string;
  /** Current roster. The authoritative list of who is in the club right now. */
  circle_user_array: number[];
  daily_average: number;
  monthly_average: number;
  fan_count: number;
  rank: number;
  updated_at: string;
  is_active: boolean;
  rank_diff: number;
  names: string[];
  daily_diff: number;
  is_rolling_updated: number;
}

export interface ClubDailyHistoryOut {
  rank: number;
  rank_gain: number;
  interpolated_fan_count: number;
  interpolated_fan_gain: number;
  /** Day of month, 1..31 — NOT a date. Resolve against the month context. */
  actual_date: number;
}

export interface ClubMonthlyHistoryOut {
  rank: number;
  rank_gain: number;
  fan_count: number;
  monthly_fan_gain: number;
  /** YYYYMM */
  year_month: number;
}

export interface ClubFriendProfileOut {
  friend_viewer_id: number;
  name: string;
  leader_chara_id: number;
  membership: number;
  /** Chrono's own long-window average. NOT the metric this project ranks on. */
  daily_average: number;
  monthly_average: number;
  join_time: string;
  fan_count: number;
  honor_id: number;
  last_login_time: string;
  leader_chara_dress_id: number;
  support_card_id: number;
  team_evaluation_point: number;
  updated_at: string;
  /** Name history, newest first. Players rename often. */
  names: string[];
  /** Always 0 in practice — do not use. */
  daily_diff: number;
  monthly_diff: number;
  last_month: number;
}

export interface ClubFriendHistoryOut {
  friend_viewer_id: number;
  friend_name: string;
  /** Day of month, 1..31 — NOT a date. */
  actual_date: number;
  interpolated_fan_count: number;
  /** Reset to 0 for days before a mid-month club move. */
  adjusted_interpolated_fan_gain: number;
  adjusted_fan_gain_cumulative: number;
}

export interface ClubProfileResponse {
  club: ClubOut[];
  club_daily_history: ClubDailyHistoryOut[];
  club_monthly_history: ClubMonthlyHistoryOut[];
  club_friend_profile: ClubFriendProfileOut[];
  club_friend_history: ClubFriendHistoryOut[];
  month_filter: { sdate: string }[];
}

export interface ClubMonthResponse {
  club_daily_history: ClubDailyHistoryOut[];
  club_friend_history: ClubFriendHistoryOut[];
  message: string | null;
}

// ------------------------------------------------------------ our shapes ----

export interface Env {
  DB: D1Database;
  CHRONO_TOKEN: string;
  SESSION_SECRET: string;
  ENVIRONMENT: string;
}

/** One member's derived standing for a single day. */
export interface MemberDayRow {
  friendViewerId: number;
  ymd: number;
  circleId: number;
  fanCount: number;
  fanGain: number;
  mtdCumulative: number;
  /** Days in THIS club this month — the denominator. See D016. */
  daysActive: number;
  mtdAvg: number;
  mtdAvgDelta: number;
  rankInClub: number;
}
