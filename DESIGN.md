# Design constraints

Read this before writing any component. These are constraints, not suggestions.

The brief was "cute and bubbly", in the clubs' teal and lavender — and
explicitly *not* looking AI-generated. Those two pull against each other:
"cute" defaults land on exactly the rounded-purple-gradient-card look that reads
as machine-made. So the rules below are mostly about what **not** to reach for.

## Banned

Each of these is a documented tell of generated UI. None of them appear here.

- **Inter** or **Poppins** as the typeface
- **purple → blue gradients**, and gradients as decoration generally
- **glassmorphism** / frosted cards
- the **`rounded-2xl shadow-lg p-6` card**
- a **centred hero with a pill badge above the H1**
- **three-across feature cards with an icon on top**
- **coloured left or top borders** on cards
- **emoji as navigation icons**
- **ALL-CAPS section labels**
- stock Tailwind greys (`slate-*`, `zinc-*`, `gray-*`) and the **default radius
  and shadow scales** — every colour and radius comes from our `@theme` tokens
- large **coloured glows**
- **dark mode as the default aesthetic**

## Committed choices

Three decisions made up front, then applied consistently. Consistency is what
separates designed from generated.

### 1. Palette

Brand teal `#00B5BE` and lavender `#DFC8E7`, declared as OKLCH in the `@theme`
block in `src/web/styles.css`.

| token | role |
|---|---|
| `--color-teal-*` | the single load-bearing accent: positive change, active state, key numerals |
| `--color-lav-*` | surface tints and fills **only** — never text |
| `--color-cream-*` | page and card backgrounds. Not `#fff` |
| `--color-ink-*` | text. A warm near-black, not `#000` and not a stock grey |
| `--color-coral-*` | negative change. Deliberately **not** `red-500` |

Contrast rules that follow from the palette:

- Brand teal on cream fails WCAG AA at body size. It is reserved for **large
  numerals, fills and borders**. Body-weight text uses `--color-teal-700`.
- Lavender is far too light to carry text at any size. Fills only.
- Both delta colours are checked against cream and against their own tint.

### 2. Type

- **Display / headings and numerals**: Baloo 2 — rounded, warm, carries the
  bubbly brief without defaulting to Poppins.
- **Body / UI**: Figtree.
- **Every fan figure uses tabular lining numerals** (`font-variant-numeric:
  tabular-nums lining-nums`). Misaligned digits in a column of eight-figure
  numbers is the single thing that makes a data table look amateur, and this
  site is mostly a data table.
- Fonts are **self-hosted** as woff2, not fetched from Google — the artifact
  CSP blocks external hosts and it is one less third party.

### 3. One repeated primitive: the capsule

Members are capsules. Stats are capsules. The whole UI is one shape repeated at
different scales, which is what makes it read as a system.

- **Fully rounded** (`--radius-pill`, 999px) for member rows, stat pills, badges
- **Modestly rounded** (`--radius-card`, 12px) for the containers holding them
- The radius scale is deliberately **non-uniform**. A uniform 16px everywhere is
  the generated look; extremes at both ends read as chosen.

## Everything else

- **Shadows**: one teal-tinted shadow (`--shadow-lift`), on row hover only. Cards sit flat on a border. No glows.
- **Committed light theme.** Cute-and-bubbly does not survive an inverted token
  dump. Dark mode, if it ever arrives, is a second real design.
- **Motion**: fan counts roll up on mount, rank arrows animate, rows lift on
  hover. `prefers-reduced-motion` disables all of it.
- **Density**: this is a leaderboard people scan on a phone. Rows are compact
  and the numbers are the loudest thing on screen.
- **Copy** is in the clubs' own voice ("Daily Dose of Data"), never generated
  marketing filler. No "Empower your club with real-time analytics".
- **Icons**: `lucide-react` as a utility set for affordances only. It is not the
  page's visual identity, and never a decorative row of feature icons.

## The one screen that matters

Most people arrive from a Discord link, on a phone, to answer one question:
*where do I stand?* So the landing page is a search box and their own row —
not a dashboard, not a hero, not a feature grid.
