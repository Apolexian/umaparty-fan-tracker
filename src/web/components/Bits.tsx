import { Link } from "react-router-dom";
import { compactFans, signed } from "../lib/format.ts";

/**
 * Day-over-day change in average daily fans.
 *
 * Teal for up, coral for down — and the darker steps, because brand teal is
 * only 2.45:1 on cream and fails AA even at large sizes (DESIGN.md).
 */
export function Delta({ value, className = "" }: { value: number; className?: string }) {
  if (value === 0) {
    return <span className={`tnum text-ink-400 ${className}`}>—</span>;
  }
  const up = value > 0;
  return (
    <span
      className={`tnum font-semibold ${up ? "text-teal-700" : "text-coral-700"} ${className}`}
      title={`${up ? "up" : "down"} ${Math.abs(value).toLocaleString("en-US")} vs the previous day`}
    >
      {signed(value)}
    </span>
  );
}

/** Movement between clubs in the projected reshuffle. */
export function DirectionMark({ direction }: { direction: "up" | "down" | "same" }) {
  if (direction === "same") {
    return (
      <span className="text-ink-400" aria-label="staying put">
        ·
      </span>
    );
  }
  const up = direction === "up";
  return (
    <span
      className={up ? "text-teal-700" : "text-coral-700"}
      aria-label={up ? "would move up a club" : "would move down a club"}
    >
      {up ? "▲" : "▼"}
    </span>
  );
}

const CLUB_TINTS: Record<number, string> = {
  1: "bg-teal-500 text-cream-50",
  2: "bg-teal-300 text-teal-900",
  3: "bg-lav-300 text-ink-900",
  4: "bg-lav-200 text-ink-700",
  5: "bg-cream-300 text-ink-700",
};

/** Club identity as a capsule — the repeated primitive from DESIGN.md. */
export function ClubChip({
  name,
  slotOrder,
  to,
  className = "",
}: {
  name: string;
  slotOrder?: number;
  to?: string;
  className?: string;
}) {
  const tint = CLUB_TINTS[slotOrder ?? 0] ?? "bg-cream-300 text-ink-700";
  const body = (
    <span
      className={`capsule inline-flex items-center px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap ${tint} ${className}`}
    >
      {name}
    </span>
  );
  return to ? (
    <Link to={to} className="hover:opacity-80">
      {body}
    </Link>
  ) : (
    body
  );
}

export function StatPill({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="card px-4 py-3" title={hint}>
      <div className="text-xs font-medium text-ink-500">{label}</div>
      <div className="tnum font-display text-2xl leading-tight font-bold text-ink-900">{value}</div>
    </div>
  );
}

/** Rank badge. Top three get the accent fill; it is a fill, not text. */
export function RankBadge({ rank }: { rank: number }) {
  const top = rank <= 3;
  return (
    <span
      className={`capsule tnum inline-flex h-7 min-w-7 items-center justify-center px-2 text-sm font-bold ${
        top ? "bg-teal-500 text-cream-50" : "bg-cream-200 text-ink-600"
      }`}
    >
      {rank}
    </span>
  );
}

export function Fans({ value, className = "" }: { value: number; className?: string }) {
  return (
    <span className={`tnum ${className}`} title={value.toLocaleString("en-US")}>
      {compactFans(value)}
    </span>
  );
}

export function Spinner({ label = "Loading" }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-16 text-ink-500">
      <span className="capsule h-2 w-2 animate-pulse bg-teal-500" />
      <span className="text-sm">{label}…</span>
    </div>
  );
}

export function ErrorNote({ message }: { message: string }) {
  return (
    <div className="card border-coral-300 bg-coral-100 px-4 py-3 text-sm text-coral-700">
      {message}
    </div>
  );
}
