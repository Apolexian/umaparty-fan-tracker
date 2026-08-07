import {
  BarController,
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  Filler,
  LinearScale,
  LineController,
  LineElement,
  PointElement,
  Tooltip,
  type ChartOptions,
  type TooltipItem,
} from "chart.js";
import { useEffect, useRef, useState } from "react";
import { Bar, Chart, Line } from "react-chartjs-2";

import { compactFans, fullFans, ymdLabel } from "../lib/format.ts";
import { Button } from "./Bits.tsx";

// The controllers matter, not just the elements: <Bar> and <Line> register
// their own, but the generic <Chart> used for the mixed bar+line does not, and
// omitting them fails only at runtime with `"bar" is not a registered
// controller` — a blank page that typecheck, build and tests all pass.
ChartJS.register(
  CategoryScale,
  LinearScale,
  BarController,
  BarElement,
  LineController,
  LineElement,
  PointElement,
  Filler,
  Tooltip,
);

// chart.js needs concrete colours, not CSS custom properties. These mirror the
// @theme tokens in styles.css; keep them in step.
const TEAL = "oklch(60% 0.106 201.1)";
const TEAL_FILL = "oklch(75.5% 0.108 201.1 / 0.22)";
const TEAL_BAR = "oklch(70.3% 0.1196 201.1)";
const CREAM_BAR = "oklch(92% 0.026 85)";
const INK_SOFT = "oklch(62% 0.012 320)";
const GRID = "oklch(92% 0.026 85)";
const INK_LINE = "oklch(34% 0.02 320)";

const FONT = { family: "Figtree, ui-sans-serif, system-ui, sans-serif", size: 11 };

/** Shared axis/tooltip setup so the two charts read as one system. */
function baseOptions(valueLabel: string, beginAtZero: boolean): ChartOptions<"line" | "bar"> {
  return {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: "index", intersect: false },
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: "oklch(22% 0.022 320)",
        titleFont: { ...FONT, weight: "bold" },
        bodyFont: FONT,
        padding: 10,
        displayColors: false,
        callbacks: {
          // Exact figures in the tooltip; the axis stays compact.
          label: (item: TooltipItem<"line" | "bar">) =>
            `${valueLabel}: ${fullFans(Number(item.parsed.y))}`,
        },
      },
    },
    scales: {
      x: {
        grid: { display: false },
        border: { color: GRID },
        ticks: { color: INK_SOFT, font: FONT, maxRotation: 0, autoSkipPadding: 12 },
      },
      y: {
        type: "linear",
        beginAtZero,
        grid: { color: GRID },
        border: { display: false },
        ticks: {
          color: INK_SOFT,
          font: FONT,
          maxTicksLimit: 5,
          callback: (value) => compactFans(Number(value)),
        },
      },
    },
  };
}

export interface DayPoint {
  ymd: number;
  value: number;
  /** Marks a gain the game wiped on a club move — drawn in a muted fill. */
  muted?: boolean;
}

export function LineChart({
  points,
  valueLabel,
  height = 220,
}: {
  points: DayPoint[];
  valueLabel: string;
  height?: number;
}) {
  if (points.length < 2) return null;

  // A month-to-date average never approaches zero, so a zero-based axis would
  // flatten every chart into a straight line.
  const options = baseOptions(valueLabel, false) as ChartOptions<"line">;

  return (
    <div style={{ height }}>
      <Line
        options={options}
        data={{
          labels: points.map((p) => ymdLabel(p.ymd)),
          datasets: [
            {
              data: points.map((p) => p.value),
              borderColor: TEAL,
              backgroundColor: TEAL_FILL,
              borderWidth: 2,
              fill: true,
              tension: 0.25,
              pointRadius: 0,
              pointHoverRadius: 4,
              pointHoverBackgroundColor: TEAL,
              pointHoverBorderColor: "white",
              pointHoverBorderWidth: 2,
            },
          ],
        }}
      />
    </div>
  );
}

/**
 * Daily gain as bars with the running month-to-date average over the top.
 *
 * They were two charts. Early in a month the running average is dominated by
 * each day's gain, so both drew the same wave and one of them was noise.
 * Combined, the bars are what happened and the line is what it does to the
 * number the reshuffle ranks on.
 */
export function GainAndAverageChart({
  points,
  averages,
  height = 240,
}: {
  points: DayPoint[];
  averages: number[];
  height?: number;
}) {
  if (points.length === 0) return null;

  const options = baseOptions("Gained", true) as ChartOptions<"bar">;
  // Second axis: the average sits an order of magnitude away from a single
  // day's gain, so sharing one scale would flatten the line onto the floor.
  options.scales = {
    ...options.scales,
    avg: {
      type: "linear",
      position: "right",
      beginAtZero: false,
      grid: { display: false },
      border: { display: false },
      ticks: {
        color: TEAL,
        font: FONT,
        maxTicksLimit: 5,
        callback: (value) => compactFans(Number(value)),
      },
    },
  };
  options.plugins!.tooltip!.callbacks = {
    label: (item: TooltipItem<"bar">) =>
      `${item.datasetIndex === 0 ? "Gained" : "Average"}: ${fullFans(Number(item.parsed.y))}`,
  };

  return (
    <div style={{ height }}>
      <Chart
        type="bar"
        options={options as ChartOptions<"bar" | "line">}
        data={{
          labels: points.map((p) => ymdLabel(p.ymd)),
          datasets: [
            {
              type: "bar" as const,
              label: "Gained",
              data: points.map((p) => p.value),
              backgroundColor: points.map((p) => (p.muted ? CREAM_BAR : TEAL_BAR)),
              hoverBackgroundColor: TEAL,
              borderRadius: 3,
              maxBarThickness: 44,
              order: 2,
            },
            {
              label: "Average",
              type: "line" as const,
              data: averages,
              yAxisID: "avg",
              borderColor: INK_LINE,
              borderWidth: 2,
              pointRadius: 0,
              pointHoverRadius: 4,
              tension: 0.25,
              fill: false,
              order: 1,
            },
          ],
        }}
      />
    </div>
  );
}

export function BarChart({
  points,
  valueLabel,
  height = 220,
}: {
  points: DayPoint[];
  valueLabel: string;
  height?: number;
}) {
  if (points.length === 0) return null;

  const options = baseOptions(valueLabel, true) as ChartOptions<"bar">;

  return (
    <div style={{ height }}>
      <Bar
        options={options}
        data={{
          labels: points.map((p) => ymdLabel(p.ymd)),
          datasets: [
            {
              data: points.map((p) => p.value),
              backgroundColor: points.map((p) => (p.muted ? CREAM_BAR : TEAL_BAR)),
              hoverBackgroundColor: TEAL,
              borderRadius: 3,
              // Caps the width so a six-day month does not render six slabs.
              maxBarThickness: 44,
            },
          ],
        }}
      />
    </div>
  );
}

/**
 * Distinct hues for a 30-member club.
 *
 * Generated rather than hand-picked: a fixed palette runs out well before 30
 * and starts repeating, which is worse than slightly awkward hues. The golden
 * ratio step spreads them so adjacent members never land on neighbouring
 * colours, and lightness alternates so similar hues still separate.
 */
function seriesColour(index: number): string {
  const hue = (index * 137.508) % 360;
  const light = index % 2 === 0 ? 62 : 48;
  return `oklch(${light}% 0.15 ${hue})`;
}

export interface MemberSeries {
  friendViewerId: number;
  name: string;
  points: { ymd: number; value: number }[];
}

/**
 * Every member's cumulative progress through the month on one chart.
 *
 * Thirty lines is a lot, so hovering isolates a single series and the legend
 * doubles as a filter — the shape of the pack matters as much as any one line.
 */
export function MemberProgressionChart({
  series,
  days,
  height = 460,
  hidden,
  onHiddenChange,
}: {
  series: MemberSeries[];
  days: number[];
  height?: number;
  hidden: Set<number>;
  onHiddenChange: (next: Set<number>) => void;
}) {
  // Hovering isolates temporarily; clicking pins it. With thirty lines the pack
  // is unreadable and picking one out by eye is impossible.
  const [focus, setFocus] = useState<number | null>(null);
  // A single click has to wait to find out whether it is half of a double
  // click, since the two mean different things here.
  const clickTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (clickTimer.current) clearTimeout(clickTimer.current);
    },
    [],
  );

  if (series.length === 0 || days.length < 2) return null;

  const allIds = series.map((s) => s.friendViewerId);
  const isolatedTo =
    hidden.size === series.length - 1
      ? (allIds.find((id) => !hidden.has(id)) ?? null)
      : null;

  function isolate(viewerId: number) {
    // Clicking the already-isolated member puts everyone back.
    onHiddenChange(
      isolatedTo === viewerId ? new Set() : new Set(allIds.filter((id) => id !== viewerId)),
    );
  }

  function hide(viewerId: number) {
    const next = new Set(hidden);
    next.add(viewerId);
    onHiddenChange(next);
  }

  const options = baseOptions("Total", true) as ChartOptions<"line">;
  // One line at a time. `index` mode lists all thirty datasets at the hovered
  // day, which is unreadable.
  options.interaction = { mode: "nearest", axis: "xy", intersect: false };
  options.plugins!.tooltip!.mode = "nearest";
  options.plugins!.tooltip!.intersect = false;
  options.plugins!.tooltip!.callbacks = {
    title: (items: TooltipItem<"line">[]) => items[0]?.label ?? "",
    label: (item: TooltipItem<"line">) =>
      `${item.dataset.label}: ${fullFans(Number(item.parsed.y))}`,
  };

  const visible = series.filter((s) => !hidden.has(s.friendViewerId));

  return (
    <div>
      <div style={{ height }}>
        <Line
          options={options}
          data={{
            labels: days.map((ymd) => ymdLabel(ymd)),
            datasets: visible.map((s) => {
              const colour = seriesColour(series.indexOf(s));
              const dimmed = focus !== null && focus !== s.friendViewerId;
              const lifted = focus === s.friendViewerId;
              const byDay = new Map(s.points.map((p) => [p.ymd, p.value]));

              return {
                label: s.name,
                data: days.map((ymd) => byDay.get(ymd) ?? null),
                borderColor: dimmed ? "oklch(88% 0.01 260 / 0.3)" : colour,
                backgroundColor: colour,
                borderWidth: lifted ? 4.5 : 2.75,
                pointRadius: 0,
                pointHoverRadius: 5,
                tension: 0.25,
                fill: false,
                spanGaps: true,
                // Draw the focused line last so it sits above the pack.
                order: lifted ? 0 : 1,
              };
            }),
          }}
        />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button tone="quiet" className="!px-2.5 !py-1 text-xs" onClick={() => onHiddenChange(new Set())}>
          Show all
        </Button>
        <Button
          tone="quiet"
          className="!px-2.5 !py-1 text-xs"
          onClick={() => onHiddenChange(new Set(allIds))}
        >
          Hide all
        </Button>
        <span className="text-[11px] text-ink-400">
          click a name to isolate it · double-click to hide it
        </span>
        {hidden.size > 0 && (
          <span className="tnum ml-auto text-[11px] text-ink-400">{hidden.size} hidden</span>
        )}
      </div>

      <ul
        className="mt-1.5 grid gap-x-2 gap-y-0.5"
        style={{ gridTemplateColumns: "repeat(auto-fill, minmax(9.5rem, 1fr))" }}
        onMouseLeave={() => setFocus(null)}
      >
        {series.map((s, i) => {
          const off = hidden.has(s.friendViewerId);
          const pinned = isolatedTo === s.friendViewerId;
          return (
            <li key={s.friendViewerId}>
              <button
                onMouseEnter={() => setFocus(off ? null : s.friendViewerId)}
                onClick={() => {
                  if (clickTimer.current) clearTimeout(clickTimer.current);
                  clickTimer.current = setTimeout(() => isolate(s.friendViewerId), 220);
                }}
                onDoubleClick={() => {
                  if (clickTimer.current) clearTimeout(clickTimer.current);
                  hide(s.friendViewerId);
                }}
                className={`flex w-full items-center gap-1.5 rounded-[6px] px-1.5 py-1 text-left text-xs transition-colors hover:bg-cream-200 ${
                  off ? "opacity-35" : ""
                } ${pinned ? "bg-lav-200 font-bold" : ""}`}
              >
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-[2px]"
                  style={{ background: seriesColour(i) }}
                />
                <span className="truncate text-ink-700">{s.name}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
