#!/usr/bin/env node
/**
 * Design-system lint — see docs/05-design-system.md ("Warm & Soft").
 *
 * Takes file paths as arguments and exits non-zero on a violation, which is the shape
 * the coach-core `lint` gate expects (it appends the changed file path to the command).
 *
 * The rules changed direction when the design did. The old set enforced austerity —
 * no shadows, 2px radii, small dense type. Those are now the opposite of the goal, so
 * what remains guards the two things that actually make or break this design:
 *
 *   1. **Comfort.** Type and hit areas must not shrink back below the sizes that made
 *      the interface usable. This is the complaint that prompted the redesign.
 *   2. **Identity.** No indigo, violet or purple, and no cool grey. The warm sand
 *      palette is what stops it reading as a generic AI app.
 *
 * Hard-coded colours and sizes are also rejected in favour of tokens, because a design
 * erodes through one-off values far more often than through a deliberate change.
 */
import fs from "node:fs";
import path from "node:path";

/**
 * Replace comment bodies with spaces, preserving length and newlines so every byte
 * offset — and therefore every reported line number — stays exact. Scanning blanked
 * text means a rule can never fire on prose that merely mentions a banned value.
 */
function blankComments(text, isCss) {
  const blanked = text.split("");
  let i = 0;
  let state = "code";

  while (i < text.length) {
    const c = text[i];
    const next = text[i + 1];

    if (state === "code") {
      if (c === "/" && next === "*") {
        state = "block";
        blanked[i] = " ";
        blanked[i + 1] = " ";
        i += 2;
        continue;
      }
      if (!isCss && c === "/" && next === "/") {
        state = "line";
        blanked[i] = " ";
        blanked[i + 1] = " ";
        i += 2;
        continue;
      }
      if (c === "'") state = "single";
      else if (c === '"') state = "double";
      else if (c === "`") state = "template";
      i += 1;
      continue;
    }

    if (state === "block") {
      if (c === "*" && next === "/") {
        blanked[i] = " ";
        blanked[i + 1] = " ";
        state = "code";
        i += 2;
        continue;
      }
      if (c !== "\n" && c !== "\r") blanked[i] = " ";
      i += 1;
      continue;
    }

    if (state === "line") {
      if (c === "\n") {
        state = "code";
        i += 1;
        continue;
      }
      if (c !== "\r") blanked[i] = " ";
      i += 1;
      continue;
    }

    if (c === "\\") {
      i += 2;
      continue;
    }
    if (
      (state === "single" && c === "'") ||
      (state === "double" && c === '"') ||
      (state === "template" && c === "`")
    ) {
      state = "code";
    }
    i += 1;
  }

  return blanked.join("");
}

const RULES = [
  {
    name: "indigo/violet",
    re: /#(?:4f46e5|6366f1|818cf8|7c3aed|8b5cf6|a78bfa|eef2ff|23233f|667eea)\b/gi,
    hint:
      "Use var(--accent). Purple is the generic-AI tell. Note indigo-500 (#6366f1) is hue 239 " +
      "and slips under the e2e hue check, so this hex list is the layer that catches it.",
  },
  {
    name: "tailwind cool utility",
    re: /\b(?:bg|text|border|ring|from|to|via)-(?:indigo|violet|purple|fuchsia|slate|zinc|gray)-\d{2,3}\b/g,
    hint: "Use the design tokens: --ink, --ink-soft, --surface, --line, --accent, or a --s-* status hue.",
  },
];

/**
 * Hard-coded colours outside the token block.
 *
 * A `--custom-property: #hex` declaration is exactly where hex values belong — that is
 * the palette. What erodes a design is a one-off literal in a rule somewhere, so only
 * those are flagged. `#fff` stays allowed: text on the accent fill needs a literal.
 */
const HEX_DECL = /(^|[;{}\s])(-{0,2}[a-zA-Z][\w-]*)\s*:\s*(#[0-9a-fA-F]{3,8})\b/g;
const HEX_ALLOWED = /^#(?:fff|ffffff)$/i;

/** Anything below these is a comfort regression, which is what the redesign fixed. */
const MIN_FONT_PX = 12;
const FONT_DECL = /\bfont-size\s*:\s*([0-9.]+)(px|rem)\b/g;

/** Interactive elements must stay reachable by thumb. */
const MIN_TAP_PX = 32;
const MIN_HEIGHT_DECL = /\bmin-height\s*:\s*([0-9.]+)(px|rem)\b/g;

/**
 * Resolve a declared length to px. Both floors above are stated in px.
 *
 * The two floor rules are the only ones in this file that fail OPEN: a rule that does not
 * match simply never fires, so a token scale authored in rem would switch both comfort
 * guarantees off with nothing reported. Every other rule here fails closed. 1rem is taken
 * as 16px, this app's root size — which is also why the token block itself stays in px: a
 * per-file linter cannot resolve a rem whose root size is declared in another file.
 */
const toPx = (n, unit) => (unit === "rem" ? n * 16 : n);
/**
 * A class vocabulary, not a description of the DOM.
 *
 * Renaming a class without adding the new name here switches this rule off for that
 * component and reports nothing — the same fail-open shape as the unit bug above. Add a new
 * name BEFORE the CSS that uses it lands; remove an old one only once nothing uses it.
 */
/**
 * A class vocabulary, not a description of the DOM.
 *
 * Renaming a class without adding the new name here switches this rule off for that
 * component and reports nothing — the same fail-open shape as the unit bug above. Add a
 * new name BEFORE the CSS that uses it lands; remove an old one only once nothing uses it.
 *
 * NOTE the boundary. This list was previously wrapped in \b(...)\b, and a leading \b before a
 * literal "." only matches when a word character precedes it — which never happens for a
 * bare class selector at the start of a rule. Every dotted entry was therefore dead: only
 * "button" ever fired, so ".select { min-height: 28px }" passed the tap floor silently.
 * There is no leading boundary now, and the trailing lookahead is what keeps ".tab" from
 * matching ".tabs".
 */
const TAP_NAMES = [
  "button",
  "\\.tab",
  "\\.rail-link",
  "\\.tree-item",
  "\\.tree-toggle",
  "\\.nav-item",
  "\\.sidebar-toggle",
  "\\.breadcrumb-link",
  "\\.select",
  "\\.input",
  "\\.field",
  "\\.criteria",
  "\\.proposal-row",
  "\\.palette-item",
  "\\.panel-close",
  "\\.icon-btn",
];

const TAP_CONTEXT = new RegExp(
  "(" + TAP_NAMES.join("|") + ")(?![\\w-])",
);

const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{1F900}-\u{1F9FF}]/gu;

const lineOf = (text, index) => text.slice(0, index).split(/\r?\n/).length;

const files = process.argv.slice(2).filter((f) => /\.(tsx|jsx|css)$/.test(f));
if (files.length === 0) process.exit(0);

let failed = false;

for (const file of files) {
  let raw;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch {
    continue; // deleted between the edit and the hook
  }

  const isCss = path.extname(file) === ".css";
  const text = blankComments(raw, isCss);
  const lines = raw.split(/\r?\n/);

  const report = (index, name, hint) => {
    const line = lineOf(text, index);
    console.error(`${file}:${line}  [${name}]  ${(lines[line - 1] ?? "").trim()}\n    -> ${hint}`);
    failed = true;
  };

  for (const rule of RULES) {
    rule.re.lastIndex = 0;
    let m;
    while ((m = rule.re.exec(text)) !== null) report(m.index, rule.name, rule.hint);
  }

  HEX_DECL.lastIndex = 0;
  let hex;
  while ((hex = HEX_DECL.exec(text)) !== null) {
    const prop = hex[2] ?? "";
    const value = hex[3] ?? "";
    if (prop.startsWith("--")) continue; // the palette itself
    if (HEX_ALLOWED.test(value)) continue;
    report(
      hex.index,
      "hard-coded colour",
      `${value} outside the token block. Use --ink, --surface, --line, --accent or a --s-* hue.`,
    );
  }

  FONT_DECL.lastIndex = 0;
  let f;
  while ((f = FONT_DECL.exec(text)) !== null) {
    const px = toPx(Number.parseFloat(f[1] ?? "0"), f[2]);
    if (px >= MIN_FONT_PX) continue;
    report(
      f.index,
      "type too small",
      `${px}px is below the ${MIN_FONT_PX}px floor. Small type is the complaint this design fixed.`,
    );
  }

  MIN_HEIGHT_DECL.lastIndex = 0;
  let h;
  while ((h = MIN_HEIGHT_DECL.exec(text)) !== null) {
    const px = toPx(Number.parseFloat(h[1] ?? "0"), h[2]);
    if (px >= MIN_TAP_PX) continue;
    // Only complain when the declaration is plausibly on something interactive.
    const around = text.slice(Math.max(0, h.index - 400), h.index);
    if (!TAP_CONTEXT.test(around)) continue;
    report(
      h.index,
      "tap target too small",
      `${px}px min-height on an interactive element. Use var(--tap).`,
    );
  }

  EMOJI.lastIndex = 0;
  let e;
  while ((e = EMOJI.exec(text)) !== null) {
    report(e.index, "emoji", "No emoji in UI chrome; use a status chip or an inline SVG.");
  }
}

if (failed) {
  console.error("\nDesign rules: see docs/05-design-system.md");
  process.exit(1);
}
