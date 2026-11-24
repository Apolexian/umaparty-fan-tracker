// Draws the Daily Dose of Data board straight onto a canvas, from the data.
//
// It replaced an html-to-image screenshot of the page. That was slow — it
// serialises the DOM, inlines fonts and rasterises an SVG — and the clipboard
// write only happened once it finished, so clicking into Discord in the
// meantime took focus away from the page and the copy failed. Drawing from
// data takes milliseconds and does not depend on what is on screen, its
// scroll position, or the viewer's theme.
//
// The layout mirrors the desktop board in Home.tsx: one column per club, full
// numbers, the fixed green/red deltas. Colours are the LIGHT theme on purpose:
// the image is for posting, and should look the same whoever makes it.

import type { ClubSummary, Placement } from "./api.ts";
import { fullFans, signedFull, ymdLabel } from "./format.ts";

export interface BoardPending {
  name: string;
  joined_ymd: number | null;
}

export interface BoardData {
  clubs: ClubSummary[];
  members: Map<number, Placement[]>;
  pending: Map<number, BoardPending[]>;
}

// Light-theme tokens from styles.css. Canvas parses oklch() like CSS does.
const C = {
  page: "#fdfaf1",
  card: "oklch(99.2% 0.008 85)", // cream-50
  band: "oklch(97.8% 0.014 85)", // cream-100
  line: "oklch(95.4% 0.02 85)", // cream-200
  rule: "oklch(92% 0.026 85)", // cream-300
  ink400: "oklch(62% 0.012 320)",
  ink500: "oklch(52% 0.015 320)",
  ink600: "oklch(42% 0.018 320)",
  ink700: "oklch(34% 0.02 320)",
  ink900: "oklch(22% 0.022 320)",
  gold700: "oklch(58% 0.13 75)",
  up: "#00B050", // fixed per club request, see Delta in Bits.tsx
  down: "#FF0000",
};

/** Same slot → tint mapping as ClubChip. */
const TINTS: Record<number, { bg: string; fg: string }> = {
  1: { bg: "oklch(70.3% 0.1196 201.1)", fg: "#ffffff" },
  2: { bg: "oklch(81% 0.092 201.1)", fg: "oklch(33% 0.058 201.1)" },
  3: { bg: "oklch(86.1% 0.0489 317.4)", fg: C.ink900 },
  4: { bg: "oklch(90% 0.036 317.4)", fg: C.ink700 },
  5: { bg: C.rule, fg: C.ink700 },
};

const DISPLAY = '"Baloo 2", "Segoe UI", system-ui, sans-serif';
const SANS = 'Figtree, "Segoe UI", system-ui, sans-serif';

const SCALE = 2; // legible after Discord recompresses it
const PAD = 16;
const GAP = 12;
// A little wider than the on-screen column (20.5rem), which leaves names only
// ~76px beside full-length numbers; the image has the room, so names get it.
const COL_W = 360;
const HEAD_H = 50;
const TH_H = 26;
const ROW_H = 30;
const FOOT_H = 28;

/**
 * Render the board as a PNG. Fonts are awaited first so the canvas does not
 * fall back to a system face on a cold cache.
 */
export async function renderBoardPng(data: BoardData): Promise<Blob> {
  await Promise.all(
    [`800 15px ${DISPLAY}`, `700 14px ${DISPLAY}`, `600 14px ${SANS}`, `700 11px ${SANS}`].map(
      (font) => document.fonts.load(font).catch(() => []),
    ),
  );

  const rows = Math.max(
    1,
    ...data.clubs.map(
      (c) => (data.members.get(c.circle_id)?.length ?? 0) + (data.pending.get(c.circle_id)?.length ?? 0),
    ),
  );
  const colH = HEAD_H + 2 + TH_H + rows * ROW_H + 2 + FOOT_H;
  const width = PAD * 2 + data.clubs.length * COL_W + Math.max(0, data.clubs.length - 1) * GAP;
  const height = PAD * 2 + colH;

  const canvas = document.createElement("canvas");
  canvas.width = width * SCALE;
  canvas.height = height * SCALE;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas is not available");
  ctx.scale(SCALE, SCALE);
  ctx.textBaseline = "middle";

  ctx.fillStyle = C.page;
  ctx.fillRect(0, 0, width, height);

  data.clubs.forEach((club, i) => {
    drawColumn(
      ctx,
      PAD + i * (COL_W + GAP),
      PAD,
      colH,
      club,
      data.members.get(club.circle_id) ?? [],
      data.pending.get(club.circle_id) ?? [],
    );
  });

  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("could not encode the image"))), "image/png"),
  );
}

function drawColumn(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  h: number,
  club: ClubSummary,
  members: Placement[],
  pending: BoardPending[],
) {
  const w = COL_W;

  // Card, clipped so the header and footer bands follow the rounded corners.
  ctx.save();
  roundRect(ctx, x, y, w, h, 12);
  ctx.fillStyle = C.card;
  ctx.fill();
  ctx.clip();

  // Header band: club chip, chrono rank, lead.
  ctx.fillStyle = C.band;
  ctx.fillRect(x, y, w, HEAD_H);
  const tint = TINTS[club.slot_order] ?? { bg: C.rule, fg: C.ink700 };
  ctx.font = `600 12px ${SANS}`;
  const chipW = ctx.measureText(club.name).width + 20;
  roundRect(ctx, x + 12, y + 8, chipW, 20, 10);
  ctx.fillStyle = tint.bg;
  ctx.fill();
  ctx.fillStyle = tint.fg;
  ctx.fillText(club.name, x + 22, y + 18.5);

  ctx.font = `800 12px ${SANS}`;
  ctx.fillStyle = C.gold700;
  ctx.textAlign = "right";
  ctx.fillText(club.rank ? `#${club.rank}` : "—", x + w - 12, y + 18.5);
  ctx.textAlign = "left";

  if (club.leader_name) {
    ctx.font = `400 11px ${SANS}`;
    ctx.fillStyle = C.ink500;
    ctx.fillText("lead", x + 12, y + 39);
    const leadX = x + 12 + ctx.measureText("lead ").width;
    ctx.font = `600 11px ${SANS}`;
    ctx.fillStyle = C.ink700;
    ctx.fillText(truncate(ctx, club.leader_name, w - (leadX - x) - 12), leadX, y + 39);
  }

  let cy = y + HEAD_H;
  ctx.fillStyle = C.rule;
  ctx.fillRect(x, cy, w, 2);
  cy += 2;

  // Column headings.
  const col = { rank: x + 10, name: x + 46, fans: x + w - 98, delta: x + w - 10 };
  ctx.font = `700 11px ${SANS}`;
  ctx.fillStyle = C.ink500;
  ctx.fillText("#", col.rank, cy + TH_H / 2);
  ctx.fillText("Name", col.name, cy + TH_H / 2);
  ctx.textAlign = "right";
  ctx.fillText("Fans/day", col.fans, cy + TH_H / 2);
  ctx.fillText("vs prev", col.delta, cy + TH_H / 2);
  ctx.textAlign = "left";
  cy += TH_H;
  ctx.fillStyle = C.rule;
  ctx.fillRect(x, cy - 1, w, 1);

  const nameW = col.fans - 104 - col.name;

  members.forEach((m, i) => {
    const mid = cy + ROW_H / 2;
    // Rank badge — uniform for every rank (DESIGN.md).
    ctx.font = `700 12px ${SANS}`;
    const label = String(i + 1);
    const badgeW = Math.max(24, ctx.measureText(label).width + 12);
    roundRect(ctx, col.rank, mid - 12, badgeW, 24, 12);
    ctx.fillStyle = C.line;
    ctx.fill();
    ctx.fillStyle = C.ink600;
    ctx.textAlign = "center";
    ctx.fillText(label, col.rank + badgeW / 2, mid + 0.5);

    ctx.textAlign = "left";
    ctx.font = `600 14px ${SANS}`;
    ctx.fillStyle = C.ink900;
    ctx.fillText(truncate(ctx, m.name, nameW), col.name, mid);

    ctx.textAlign = "right";
    ctx.font = `700 14px ${DISPLAY}`;
    ctx.fillText(fullFans(m.mtdAvg), col.fans, mid + 1);

    ctx.font = `600 12px ${SANS}`;
    ctx.fillStyle = m.mtdAvgDelta > 0 ? C.up : m.mtdAvgDelta < 0 ? C.down : C.ink400;
    ctx.fillText(m.mtdAvgDelta === 0 ? "—" : signedFull(m.mtdAvgDelta), col.delta, mid);
    ctx.textAlign = "left";

    cy += ROW_H;
    ctx.fillStyle = C.line;
    ctx.fillRect(x, cy - 1, w, 1);
  });

  // On the roster, no counted day yet (D037).
  for (const p of pending) {
    const mid = cy + ROW_H / 2;
    ctx.font = `400 14px ${SANS}`;
    ctx.fillStyle = C.ink400;
    ctx.textAlign = "center";
    ctx.fillText("—", col.rank + 12, mid);
    ctx.textAlign = "left";
    ctx.font = `600 14px ${SANS}`;
    ctx.fillStyle = C.ink500;
    ctx.fillText(truncate(ctx, p.name, nameW), col.name, mid);
    ctx.textAlign = "right";
    ctx.font = `400 12px ${SANS}`;
    ctx.fillText(p.joined_ymd ? `joined ${ymdLabel(p.joined_ymd)}` : "just joined", col.delta, mid);
    ctx.textAlign = "left";
    cy += ROW_H;
    ctx.fillStyle = C.line;
    ctx.fillRect(x, cy - 1, w, 1);
  }

  if (members.length === 0 && pending.length === 0) {
    ctx.font = `400 12px ${SANS}`;
    ctx.fillStyle = C.ink400;
    ctx.textAlign = "center";
    ctx.fillText("no data yet", x + w / 2, cy + ROW_H / 2);
    ctx.textAlign = "left";
  }

  // Footer band pinned to the bottom, so every column ends level.
  const fy = y + h - FOOT_H;
  ctx.fillStyle = C.rule;
  ctx.fillRect(x, fy - 2, w, 2);
  ctx.fillStyle = C.band;
  ctx.fillRect(x, fy, w, FOOT_H);
  ctx.font = `400 11px ${SANS}`;
  ctx.fillStyle = C.ink500;
  ctx.fillText(`${members.length + pending.length} members`, x + 12, fy + FOOT_H / 2);
  const total = members.reduce((sum, m) => sum + m.mtdAvg, 0);
  ctx.font = `700 11px ${SANS}`;
  ctx.fillStyle = C.ink700;
  ctx.textAlign = "right";
  ctx.fillText(`${fullFans(total)}/day`, x + w - 12, fy + FOOT_H / 2);
  ctx.textAlign = "left";

  ctx.restore();

  // Card border, drawn last so nothing paints over it.
  roundRect(ctx, x + 0.5, y + 0.5, w - 1, h - 1, 12);
  ctx.strokeStyle = C.rule;
  ctx.lineWidth = 1;
  ctx.stroke();
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Cut text to fit `max` px with an ellipsis, as CSS truncate does. */
function truncate(ctx: CanvasRenderingContext2D, text: string, max: number): string {
  if (ctx.measureText(text).width <= max) return text;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (ctx.measureText(`${text.slice(0, mid)}…`).width <= max) lo = mid;
    else hi = mid - 1;
  }
  return `${text.slice(0, lo)}…`;
}
