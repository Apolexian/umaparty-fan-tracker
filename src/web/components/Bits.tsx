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

/**
 * Rank badge.
 *
 * Gold for the top three, because the game marks standing with gold laurels
 * and these players read gold as "rank" before they read any label. Teal for
 * the rest of the top ten, plain otherwise. Always a fill — brand teal is
 * 2.45:1 on cream and can never carry text.
 */
export function RankBadge({ rank }: { rank: number }) {
  const tone =
    rank <= 3
      ? "bg-gold-500 text-gold-900 ring-1 ring-gold-700/40"
      : rank <= 10
        ? "bg-teal-500 text-cream-50"
        : "bg-cream-200 text-ink-600";

  return (
    <span
      className={`capsule tnum inline-flex h-7 min-w-7 items-center justify-center px-2 text-sm font-bold ${tone}`}
    >
      {rank}
    </span>
  );
}

/** Angled banner section heading, as the game sets its section titles. */
export function Ribbon({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="ribbon font-display inline-block bg-teal-500 py-1 pl-3 text-lg font-extrabold text-cream-50">
      {children}
    </h2>
  );
}

/** Chunky pressable button with the game's solid lip. */
export function Button({
  children,
  onClick,
  type = "button",
  tone = "teal",
  className = "",
  disabled,
  title,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  type?: "button" | "submit";
  tone?: "teal" | "quiet";
  className?: string;
  disabled?: boolean;
  title?: string;
}) {
  const tones = {
    teal: "bg-teal-500 text-cream-50 [--chunky-lip:var(--color-teal-700)]",
    quiet: "bg-cream-200 text-ink-700 [--chunky-lip:var(--color-cream-300)]",
  };

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`chunky px-4 py-2 text-sm font-bold disabled:opacity-60 ${tones[tone]} ${className}`}
    >
      {children}
    </button>
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
