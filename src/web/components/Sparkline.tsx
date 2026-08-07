import { useId } from "react";

export interface Point {
  x: number;
  y: number;
}

/**
 * Inline SVG line, no chart library.
 *
 * chart.js is pulled in for the richer club pages; a single-series trend of at
 * most 31 points does not justify the bundle, and hand-rolling it keeps full
 * control of the palette.
 */
export function Sparkline({
  points,
  height = 96,
  label,
}: {
  points: Point[];
  height?: number;
  label?: (point: Point) => string;
}) {
  const gradientId = useId();
  if (points.length < 2) return null;

  const width = 100; // viewBox units; the SVG scales to its container
  const ys = points.map((p) => p.y);
  const min = Math.min(...ys);
  const max = Math.max(...ys);
  const span = max - min || 1;
  // Breathing room so the extremes are not welded to the frame.
  const pad = span * 0.12;

  const toX = (i: number) => (i / (points.length - 1)) * width;
  const toY = (y: number) => height - ((y - min + pad) / (span + pad * 2)) * height;

  const line = points.map((p, i) => `${i === 0 ? "M" : "L"}${toX(i)},${toY(p.y)}`).join(" ");
  const area = `${line} L${width},${height} L0,${height} Z`;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className="w-full"
      style={{ height }}
      role="img"
      aria-label={`Trend from ${points[0]!.y} to ${points.at(-1)!.y}`}
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--color-teal-300)" stopOpacity="0.5" />
          <stop offset="100%" stopColor="var(--color-teal-300)" stopOpacity="0" />
        </linearGradient>
      </defs>

      <path d={area} fill={`url(#${gradientId})`} />
      <path
        d={line}
        fill="none"
        stroke="var(--color-teal-500)"
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
          r={i === points.length - 1 ? 3 : 2}
          fill={i === points.length - 1 ? "var(--color-teal-600)" : "var(--color-teal-400)"}
          vectorEffect="non-scaling-stroke"
        >
          {label && <title>{label(point)}</title>}
        </circle>
      ))}
    </svg>
  );
}
