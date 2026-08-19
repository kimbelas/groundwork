# 05 — Clean & Bright design system

> **This document has drifted from `app/globals.css` once already.** It described a warm
> sand-and-teal palette for a full revision after the CSS had moved to cool neutrals and a
> blue accent, and nothing caught it: the linter's colour rule deliberately exempts
> `--custom-property` declarations, because that block *is* the palette. The tokens below are
> copied from that file. **If you change one, change both in the same commit.**

## How it got here

The first design was called Blueprint: bone paper, hairline rules, no shadows, 2px radii,
13–14px type, deliberately dense, desktop-only. It was picked from a preview and rejected
once it existed, for three specific reasons — **cards too small, fonts too small, not
comfortable to use.**

The direction inverted to **comfort before density**, under the name Warm & Soft: a sand
canvas, a deep-teal accent, a serif display face. The comfort survived. The warm palette did
not — the CSS moved to near-white surfaces, cool neutrals and a blue accent under the name
**Clean & Bright**, which is what ships today and what this document now describes.

## Principles

1. **Comfortable before dense.** 17px base type, generous padding, cards tall enough to read
   at a glance. Between fitting more on screen and being easy to read, readability wins.
2. **Soft, not flat.** Rounded surfaces and quiet elevation give the eye a hierarchy. Shadows
   separate layers; they do not decorate.
3. **Words, not codes.** The screen says "High", "Medium", "80% sure", "1 of 3 done". The
   *files* still store `P1`, `M`, `0.8` — see `lib/labels.ts`. A hand-editable format and a
   readable interface are different problems.
4. **No decorative colour.** The five status hues mean something specific; nothing else is
   tinted. Indigo, violet and purple are banned outright — they are the generic-AI tell, and
   both enforcement layers check for them.
5. **Mobile is a target, not a courtesy.** Every screen works at 390px.

## Tokens

Defined in `app/globals.css`, with a full dark set under
`@media (prefers-color-scheme: dark)`.

```css
--bg: #f8fafc;            /* canvas */
--surface: #ffffff;       /* cards, panels */
--surface-2: #f1f5f9;     /* columns, rail, metabar */
--surface-sunk: #e8eef5;  /* pills, progress track */

--ink: #0f172a;           /* primary text */
--ink-soft: #475569;      /* secondary */
--ink-faint: #94a3b8;     /* tertiary, placeholders */

--line: #e2e8f0;
--line-strong: #cbd5e1;

--accent: #2563eb;        /* blue */
--accent-ink: #1d4ed8;    /* text on soft accent */
--accent-soft: #eff6ff;   /* selected, hover, badges */

--s-idea: #d97706;   --s-active: #2563eb;  --s-blocked: #dc2626;
--s-done: #16a34a;   --s-paused: #64748b;

--radius-sm: 8px;  --radius: 12px;  --radius-lg: 18px;
--shadow-sm / --shadow / --shadow-lift
--tap: 44px;              /* target hit area */
--rail-w: 264px;  --pane-x: 34px;
```

**There is no spacing scale and no type scale.** Every padding, gap and font size in this
1300-line file is a raw px literal, and roughly sixty inline style objects across the
components do the same. That absence is why "make it uniform" is currently a find-and-replace
rather than a token change.

**Token sizes stay in `px`.** A per-file linter cannot resolve a `rem` whose root size is
declared in another file. The floors accept `rem` so a stray one cannot slip under them
unnoticed — that is a safety net, not an invitation.

## Type

| Role | Face | Size |
|---|---|---|
| Display | **Newsreader** (serif) | 34px page titles, 22px section, 19px phase names |
| UI | **Inter** | 17px base, 16px controls, 15px secondary |
| Mono | **JetBrains Mono** | 13px, only for dates and ids |

Inter rather than Inter Tight: at 17px in paragraphs the tighter face reads cramped, which is
the complaint this design exists to fix.

## Components

- **Card** — 16–18px padding, 12px radius, `--shadow-sm`, a 17px semibold title, a metadata
  row in words, and a progress bar with a sentence under it.
- **Chip** — rounded pill with a 9px status dot. `text-transform: capitalize`, so a stored
  lowercase value displays capitalised without the DOM text changing.
- **Column / Phase** — its own rounded `--surface-2` panel with a counter pill.
- **Button** — pill, `--tap` min-height. `.button` is the outline default; `.button-primary`
  is the solid accent for the main action in a flow.
- **Progress bar** — `.bar` with a `--s-done` fill, always paired with words.

## Rules

- **Never below 12px type.** Body copy stays at 15px or larger.
- **Controls target 44px** (`var(--tap)`). **The enforced floor is 32px measured** — both the
  linter and `design-system.spec.ts` use 32, and the gap between the two numbers is deliberate
  headroom rather than an oversight. Inline text links are exempt; they are sized by their
  text and take their hit area from the row around them.
- **No hard-coded colours outside the token block.** One-off literals are how a palette
  erodes. A `--custom-property: #hex` declaration is exactly where hex belongs.
- **No indigo, violet or purple.** Enforced twice, because neither layer is sufficient alone:
  the spec rejects any computed hue between 240 and 300 above 0.15 saturation, and the linter
  carries a hex list for the ones that slip under it — Tailwind's `indigo-500` is hue 239.
- **No Tailwind cool-grey utility classes** (`slate`, `zinc`, `gray`). Note this bans the
  *class names*. The token block above is slate-derived by hex and that is legitimate, since
  the tokens are the palette; the app uses no Tailwind utilities at all.
- **No emoji in UI chrome.** Use a status chip or an inline SVG. The linter's range covers the
  check and cross glyphs deliberately — use an SVG, not a character.
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
- The **tab strip scrolls horizontally**, which is a deliberate scroll region and is exempted
  from the overflow check by name.
- Pinch-zoom is never disabled.

## Enforcement

Two layers, and the rule is that **a change to the design changes its guardrail in the same
commit.** A guardrail still describing a design that no longer exists is how this document
drifted in the first place.

- **`scripts/blueprint-lint.js`** runs on every `.tsx`/`.jsx`/`.css` edit via
  `.claude/gates.json`. It guards the type floor, the tap-target floor, hard-coded colours,
  banned hues and emoji.

  Both numeric floors accept `px` and `rem`, and they are the only rules in the file that
  **fail open** — a rule that does not match simply never fires, so a scale authored in `rem`
  would once have switched both comfort guarantees off with nothing reported.

  `TAP_NAMES` is a **class vocabulary, not a description of the DOM.** Renaming a class
  without adding the new name switches the rule off for that component silently, so add a new
  name *before* the CSS that uses it lands. The list was previously wrapped in word
  boundaries, which made every dotted entry dead: a leading boundary before a literal dot only
  matches when a word character precedes it, which never happens for a bare class selector at
  the start of a rule. Only `button` ever fired.

- **`tests-e2e/design-system.spec.ts`** asserts what the browser actually computed, across six
  pages, in light and dark, **and at a 390×844 phone viewport** — including that the drawer
  opens, navigates and closes, that columns stack, that the dashboard becomes cards, and that
  nothing overflows the viewport.
