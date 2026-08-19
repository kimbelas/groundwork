# 05 — Graphite design system

> **This document drifted from `app/globals.css` once already** — it described a warm
> sand-and-teal palette for a full revision after the CSS had moved on, and nothing caught
> it, because the linter's colour rule deliberately exempts `--custom-property`
> declarations: that block *is* the palette. The tokens below are copied from that file.
> **If you change one, change both in the same commit.**

## How it got here

**Blueprint** was first: bone paper, hairline rules, no shadows, 2px radii, 13–14px type,
deliberately dense, desktop-only. Picked from a preview and rejected once it existed, for
three specific reasons — **cards too small, fonts too small, not comfortable to use.**

**Warm & Soft** inverted it to comfort before density: a sand canvas, a deep-teal accent, a
serif display face. The comfort survived and is now non-negotiable. The palette did not — the
CSS quietly moved to near-white surfaces, cool neutrals and a blue accent under the name
**Clean & Bright**, and this document went a full revision without noticing.

**Graphite** is the current direction, and the first one chosen deliberately rather than
drifted into. Near-monochrome neutrals with a faint warm cast, a single accent that only ever
marks state, and one sans instead of a sans plus a serif. Comfortable sizing carried over
untouched: the rebuild changes the *shape* of the interface, never the scale.

## Principles

1. **Comfortable before dense.** 17px base type, generous padding, cards tall enough to read
   at a glance. Between fitting more on screen and being easy to read, readability wins. This
   is the one thing that has survived every redesign and it is not up for renegotiation.
2. **The accent marks state, never decorates.** Selection, focus, progress, current location.
   Because it appears nowhere else, it still means something when it does.
3. **Words, not codes.** The screen says "High", "Medium", "80% sure", "1 of 3 done". The
   *files* still store `P1`, `M`, `0.8` — see `lib/labels.ts`. A hand-editable format and a
   readable interface are different problems.
4. **Colour is data.** The five status hues say something specific; nothing else is tinted.
   Indigo, violet and purple are banned outright — the generic-AI tell, and the one hue family
   both enforcement layers hunt for.
5. **One sans, one mono.** Hierarchy is size, weight and space. There is no display face.
6. **Mobile is a target, not a courtesy.** Every screen works at 390px.

## Tokens

Defined in `app/globals.css`, with a full dark set under
`@media (prefers-color-scheme: dark)`.

```css
--bg: #f4f4f2;            /* canvas */
--surface: #ffffff;       /* cards, panels */
--surface-2: #efefec;     /* columns, rail, metabar */
--surface-sunk: #e7e7e3;  /* pills, progress track */

--ink: #17191a;           /* primary text */
--ink-soft: #5c6164;      /* secondary */
--ink-faint: #8b918f;     /* tertiary, placeholders */

--line: #e2e2de;
--line-strong: #cfcfc9;

--accent: #1f6e5b;        /* state only — selection, focus, progress, location */
--accent-ink: #175447;    /* text on soft accent */
--accent-soft: #e2efea;

--s-idea: #b0761b;   --s-active: #2a6bc4;  --s-blocked: #c0392f;
--s-done: #2f7d46;   --s-paused: #7b8280;

--radius-sm: 8px;  --radius: 12px;  --radius-lg: 18px;
--shadow-sm / --shadow / --shadow-lift
--tap: 44px;              /* target hit area */
--rail-w: 264px;  --pane-x: 34px;
```

**The accent hue is constrained.** `design-system.spec.ts` rejects any computed hue between
240 and 300 above 0.15 saturation. Graphite's accent sits around 166 and its `--s-active`
around 214, both with room to spare. A future accent must stay below 240 or above 300.

### Scales

There was no spacing or type scale at all until the rebuild: every padding, gap and size was
a raw literal, which is why "make it uniform" was a find-and-replace rather than a token
change.

```css
--space-1: 4px … --space-8: 64px          /* 4 8 12 16 24 32 48 64 */
--text-2xs: 12px … --text-3xl: 34px       /* 12 13 15 16 17 20 22 28 34 */
--lead-tight: 1.25  --lead-snug: 1.4  --lead-body: 1.6
--ctl-sm: 32px  --ctl-md: 38px  --ctl-lg: 44px
```

The type steps were chosen to **match sizes already shipping**, so naming the scale changed
no rendered type. They are adopted per component as each is rebuilt rather than in one sweep —
a mechanical pass over 1300 lines is exactly the change that regresses something nobody
notices for a week.

`--tap` is the target; `--ctl-sm` is the floor both enforcement layers check.

**Token sizes stay in `px`.** A per-file linter cannot resolve a `rem` whose root size is
declared in another file. The floors accept `rem` so a stray one cannot slip under them
unnoticed — a safety net, not an invitation.

## Type

| Role | Face | Size |
|---|---|---|
| UI | **Instrument Sans** | 17px base, 16px controls, 15px secondary, up to 34px titles |
| Mono | **JetBrains Mono** | 13px, only for dates and ids |

**There is no display face.** A serif ran on titles for two revisions, on the argument that it
stopped the app reading as a generic dashboard. It was doing that job — but the app is a tool
rather than a document, and the tools it is modelled on all use a single family. A title still
has to out-rank body copy; that is now carried by size and weight, and the e2e check asserts
exactly that rather than merely asserting the serif left.

Instrument Sans rather than Inter: Inter is the face every generated interface reaches for,
and looking generic is the specific complaint this rebuild answers.

## Components

- **Card** — 16–18px padding, 12px radius, `--shadow-sm`, a semibold title, a metadata row in
  words, and a progress bar with a sentence under it.
- **Chip** — rounded pill with a 9px status dot. `text-transform: capitalize`, so a stored
  lowercase value displays capitalised without the DOM text changing.
- **Column / Phase** — its own rounded `--surface-2` panel with a counter pill.
- **Button** — pill, `--tap` min-height. `.button` is the outline default; `.button-primary`
  is the solid accent for the main action in a flow.
- **Progress bar** — `.bar` with a `--s-done` fill, always paired with words.

## Rules

- **Never below 12px type.** Body copy stays at 15px or larger.
- **Controls target 44px** (`var(--tap)`). **The enforced floor is 32px measured** — both the
  linter and `design-system.spec.ts` use 32, and the gap is deliberate headroom rather than an
  oversight. Inline text links are exempt; they are sized by their text and take their hit
  area from the row around them.
- **No hard-coded colours outside the token block.** One-off literals are how a palette
  erodes. A `--custom-property: #hex` declaration is exactly where hex belongs.
- **No second display face.** Enforced by the linter in both CSS and CSS-in-TS.
- **No indigo, violet or purple.** Enforced twice, because neither layer is sufficient alone:
  the spec rejects hues 240–300, and the linter carries a hex list for the ones that slip
  under it — Tailwind's `indigo-500` is hue 239.
- **No Tailwind cool-grey utility classes** (`slate`, `zinc`, `gray`). This bans the *class
  names*; the app uses no Tailwind utilities at all.
- **No emoji in UI chrome.** Use a status chip or an inline SVG.
- **Never render vault prose as HTML.** Use `components/ui/Prose.tsx`; the text can come from
  an accepted AI proposal.
- **Respect `prefers-reduced-motion`.** Transitions collapse to near-zero.

## Mobile

One breakpoint, at 900px. There is no tablet tier.

- The rail becomes a **left drawer** behind a hamburger in a sticky topbar, with a dimming
  overlay. It closes on navigation and on overlay tap. `display: contents` on the wrapper is
  what lets one markup structure serve both the desktop grid and the drawer.
- **Board columns and roadmap phases stack.** Nothing important is reachable only by sideways
  scrolling.
- The **dashboard table becomes a card list** — the header row is hidden and each cell grows
  its own label from `data-label` via `::before`. Every cell must therefore carry one.
- The **tab strip scrolls horizontally**, a deliberate scroll region exempted from the
  overflow check by name.
- Pinch-zoom is never disabled.

## Enforcement

Three layers now, and the rule is that **a change to the design changes its guardrail in the
same commit.** A guardrail still describing a design that no longer exists is how this
document drifted in the first place.

- **`scripts/blueprint-lint.js`** runs on every `.tsx`/`.jsx`/`.ts`/`.css` edit via
  `.claude/gates.json`. It guards the type floor, the tap-target floor, hard-coded colours,
  banned hues, the display face, and emoji.

  `.ts` is in scope because CSS-in-TS is still CSS: the editor theme styles headings from a
  plain object and held one of the eight references to the display face, where no automation
  could reach it. Both floors read `fontSize` as well as `font-size` for the same reason.

  The floors **resolve a value before judging it** — literals, `var()` tokens including
  chains and fallbacks, and functions where the smallest length inside a `clamp()` is used,
  since that is the worst case a floor exists to catch. Until that existed they matched only
  literal numbers, so a token scale was invisible to them.

  The floors are the only rules here that **fail open**: a rule that does not match simply
  never fires. That has cost this file twice.

  `TAP_NAMES` is a **class vocabulary, not a description of the DOM.** Renaming a class
  without adding the new name switches the rule off for that component silently, so add a new
  name *before* the CSS that uses it lands.

- **`tests/design-lint.test.ts`** tests the linter itself, by execution rather than by reading
  its source. The tap-vocabulary cases are *generated from the shipped list*, so a name that
  does not actually fire fails there rather than years later. Three fail-open holes reached
  production in that file because nothing tested it.

- **`tests-e2e/design-system.spec.ts`** asserts what the browser actually computed, across six
  pages, in light and dark, **and at a 390×844 phone viewport** — including that the drawer
  opens, navigates and closes, that columns stack, that the dashboard becomes cards, and that
  nothing overflows the viewport.
