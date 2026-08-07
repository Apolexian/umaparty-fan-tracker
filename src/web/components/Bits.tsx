import { Link } from "react-router-dom";
import { compactFans, signed, signedFull } from "../lib/format.ts";

/**
 * Day-over-day change. Darker teal/coral steps: the brand tones fail AA.
 *
 * `full` spells the number out where there is room for it (desktop), matching
 * the fans column beside it.
 */
export function Delta({
  value,
  className = "",
  full = false,
}: {
  value: number;
  className?: string;
  full?: boolean;
}) {
  if (value === 0) {
    return <span className={`tnum text-ink-400 ${className}`}>—</span>;
  }
  const up = value > 0;
  return (
    <span
      className={`tnum font-semibold ${up ? "text-teal-700" : "text-coral-700"} ${className}`}
      title={`${up ? "up" : "down"} ${Math.abs(value).toLocaleString("en-US")} vs the previous day`}
    >
      {full ? (
        <>
          <span className="lg:hidden">{signed(value)}</span>
          <span className="hidden lg:inline">{signedFull(value)}</span>
        </>
      ) : (
        signed(value)
      )}
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

/** Club identity capsule. */
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

/** Uniform for every rank — no podium colours. See DESIGN.md. */
export function RankBadge({ rank }: { rank: number }) {
  return (
    <span className="capsule tnum inline-flex h-6 min-w-6 items-center justify-center bg-cream-200 px-1.5 text-xs font-bold text-ink-600">
      {rank}
    </span>
  );
}

/** Angled banner heading. */
export function Ribbon({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="ribbon font-display inline-block bg-teal-500 py-1 pl-3 text-lg font-extrabold text-cream-50">
      {children}
    </h2>
  );
}

/** Pressable button with a solid lip. */
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
