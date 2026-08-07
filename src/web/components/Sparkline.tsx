import { useId } from "react";

export interface Point {
  x: number;
  y: number;
}

/**
 * Inline SVG line, no chart library.
 *
 * A month-to-date average moves slowly by construction, so the y-axis is fitted
 * to the actual range rather than anchored at zero — otherwise every member's
 * chart is a flat line. That makes the axis labels mandatory, not decorative:
 * without them a 2% wobble and a 200% climb look identical.
 */
export function Sparkline({
  points,
  height = 88,
  format = (n: number) => String(n),
  label,
}: {
  points: Point[];
  height?: number;
  format?: (value: number) => string;
  label?: (point: Point) => string;
}) {
  const gradientId = useId();
  if (points.length < 2) return null;

  const width = 100; // viewBox units; the SVG stretches to its container
  const ys = points.map((p) => p.y);
  const min = Math.min(...ys);
  const max = Math.max(...ys);
  const span = max - min || Math.max(1, max * 0.02);
  const pad = span * 0.15;

  const toX = (i: number) => (i / (points.length - 1)) * width;
  const toY = (y: number) => height - ((y - min + pad) / (span + pad * 2)) * height;

  const line = points.map((p, i) => `${i === 0 ? "M" : "L"}${toX(i)},${toY(p.y)}`).join(" ");
  const area = `${line} L${width},${height} L0,${height} Z`;
  const last = points.at(-1)!;

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        className="w-full"
        style={{ height }}
        role="img"
        aria-label={`From ${format(points[0]!.y)} to ${format(last.y)}`}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-teal-400)" stopOpacity="0.35" />
            <stop offset="100%" stopColor="var(--color-teal-400)" stopOpacity="0" />
          </linearGradient>
        </defs>

        <path d={area} fill={`url(#${gradientId})`} />
        <path
          d={line}
          fill="none"
          stroke="var(--color-teal-600)"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />

        {points.map((point, i) => (
          <circle
            key={point.x}
            cx={toX(i)}
            cy={toY(point.y)}
            r={i === points.length - 1 ? 2.5 : 0}
            fill="var(--color-teal-700)"
            vectorEffect="non-scaling-stroke"
          >
            {label && <title>{label(point)}</title>}
          </circle>
        ))}
      </svg>

      {/* The scale. Without it the shape is meaningless. */}
      <span className="tnum pointer-events-none absolute top-0 right-0 text-[10px] text-ink-400">
        {format(max)}
      </span>
      <span className="tnum pointer-events-none absolute right-0 bottom-0 text-[10px] text-ink-400">
        {format(min)}
      </span>
    </div>
  );
}
