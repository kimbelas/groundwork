# 05 — Warm & Soft design system

## Why this replaced Blueprint

The first version of this app used a design called Blueprint: bone paper, hairline rules,
no shadows, 2px radii, 13–14px type, deliberately dense. It was chosen from a preview and
rejected once it existed, for three specific reasons — **cards too small, fonts too
small, and not comfortable to use.** Desktop-only was also an explicit non-goal at the
time, which turned out to be wrong.

So the direction inverted. **Comfort before density.** What survived is the thing that
made Blueprint worth trying: a warm palette and a serif display face, so the app does not
read as a generic AI tool. What went is the austerity.

## Principles

1. **Comfortable before dense.** 17px base type, generous padding, cards tall enough to
   read at a glance. If a choice is between fitting more on screen and being easy to
   read, readability wins.
2. **Soft, not flat.** Rounded surfaces and gentle elevation give the eye a hierarchy to
   follow. Shadows are quiet — they separate layers, they do not decorate.
3. **Words, not codes.** The screen says "High", "Medium", "80% sure", "1 of 3 done". The
   *files* still store `P1`, `M`, `0.8` — see `lib/labels.ts`. A hand-editable format and
   a readable interface are different problems.
4. **Warm, never cool.** No indigo, violet, purple, or cool grey. The sand-and-teal
   palette is the identity.
5. **Color still carries meaning.** The five status hues mean something specific.
   Nothing else is tinted for decoration.
6. **Mobile is a target, not a courtesy.** Every screen works at 390px.

## Tokens

Defined in `app/globals.css`, with a full dark-mode set.

```css
--bg: #f6f2ea;            /* warm sand canvas */
--surface: #ffffff;       /* cards, panels */
--surface-2: #fbf8f2;     /* columns, rail, metabar */
--surface-sunk: #efe9de;  /* pills, progress track */

--ink: #2a2520;           /* primary text */
--ink-soft: #665c51;      /* secondary */
--ink-faint: #968a7c;     /* tertiary, placeholders */

--line: #e6ded1;
--line-strong: #d4c9b8;

--accent: #1d5c54;        /* deep teal */
--accent-ink: #16473f;    /* text on soft accent */
--accent-soft: #e3efec;   /* selected, hover, badges */

--s-idea: #a67c2e;   --s-active: #1d5c54;  --s-blocked: #b4472f;
--s-done: #4a7c46;   --s-paused: #7d8a93;

--radius-sm: 8px;  --radius: 12px;  --radius-lg: 18px;
--shadow-sm / --shadow / --shadow-lift
--tap: 44px;              /* minimum hit area */
```

## Type

| Role | Face | Size |
|---|---|---|
| Display | **Newsreader** (serif) | 34px page titles, 22px section, 19px phase names |
| UI | **Inter** | 17px base, 16px controls, 15px secondary |
| Mono | **JetBrains Mono** | 13px, only for dates and ids |

Inter rather than Inter Tight: at 17px in paragraphs the tighter face reads as cramped,
which is the complaint this design exists to fix.

Serif titles are what keep the app from looking like every other dashboard. Do not
replace them with a heavier sans.

## Components

- **Card** — 16–18px padding, 12px radius, `--shadow-sm`, a 17px semibold title, a
  metadata row in words, and a progress bar with a sentence under it.
- **Chip** — rounded pill with a 9px status dot. `text-transform: capitalize`, so stored
  lowercase values display capitalised without the DOM text changing.
- **Column / Phase** — its own rounded `--surface-2` panel with a counter pill.
- **Button** — 44px min-height pill. `.button` is the comfortable outline default;
  `.button-primary` is the solid accent for the main action in a flow.
- **Progress bar** — `.bar` with a `--s-done` fill, always paired with words.
- **meta-pill** — a neutral pill for values that would read badly after a separator.

## Rules

- **Never below 12px type.** Body copy stays at 15px or larger.
- **Never below 44px** for a control's hit area (`var(--tap)`). Inline text links are
  exempt — they are sized by their text and get their hit area from the row around them.
- **No hard-coded colours outside the token block.** One-off literals are how a palette
  erodes.
- **No indigo, violet, purple, or Tailwind's cool greys** (`slate`, `zinc`, `gray`).
- **No emoji in UI chrome.** Use a status chip or an inline SVG.
- **Never render vault prose as HTML.** Use `components/ui/Prose.tsx`; the text can come
  from an accepted AI proposal.
- **Respect `prefers-reduced-motion`.** Transitions collapse to near-zero.

## Mobile

Breakpoint at 900px.

- The rail becomes a **left drawer** behind a hamburger in a sticky topbar, with a
  dimming overlay. It closes on navigation and on overlay tap. `display: contents` on the
  wrapper means one markup structure serves both the desktop grid and the drawer.
- **Board columns and roadmap phases stack** into a single column. Nothing important is
  reachable only by sideways scrolling.
- The **dashboard table becomes a card list** — the header row is hidden and each cell
  carries its own label via `data-label` and `::before`.
- The **tab strip scrolls horizontally**, which is a deliberate scroll region.
- Pinch-zoom is never disabled.

## Enforcement

Two layers, both of which changed direction with the design:

- `scripts/blueprint-lint.js` runs on every edit via `.claude/gates.json`. It guards the
  type floor, tap-target floor, hard-coded colours, banned hues, and emoji.
- `tests-e2e/design-system.spec.ts` asserts what the browser actually computed across
  six pages, in light and dark, **and at a 390×844 phone viewport** — including that the
  drawer opens, navigates, and closes, that columns stack, and that nothing overflows.
