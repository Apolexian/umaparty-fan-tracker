import {
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  Filler,
  LinearScale,
  LineElement,
  PointElement,
  Tooltip,
  type ChartOptions,
  type TooltipItem,
} from "chart.js";
import { Bar, Chart, Line } from "react-chartjs-2";

import { compactFans, fullFans, ymdLabel } from "../lib/format.ts";

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
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
