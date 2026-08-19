#!/usr/bin/env node
/**
 * Design-system lint — see docs/05-design-system.md ("Clean & Bright").
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
 *   2. **Identity.** No indigo, violet or purple — the generic-AI tell. The hex list below
 *      and the hue window in `tests-e2e/design-system.spec.ts` are both needed: that test
 *      rejects hues 240–300, and Tailwind's `indigo-500` sits at 239, just outside it.
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
    re: /#(?:4f46e5|6366f1|818cf8|7c3aed|8b5cf6|a78bfa|eef2ff|23233f|667eea|4338ca|3730a3|312e81|a5b4fc|c7d2fe|e0e7ff|6d28d9|5b21b6|c4b5fd|ddd6fe|ede9fe|f5f3ff)\b/gi,
    hint:
      "Use var(--accent). Purple is the generic-AI tell. Note indigo-500 (#6366f1) is hue 239 " +
      "and slips under the e2e hue check, so this hex list is the layer that catches it.",
  },
  {
    name: "second display face",
    re: /--font-newsreader|font-?[fF]amily\s*:[^;{}\n]*\b(?:Newsreader|Georgia)\b/g,
    hint:
      "One sans, one mono — the display face was dropped in the rebuild. Hierarchy comes " +
      "from size, weight and space. Use var(--font-sans).",
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

/**
 * The comfort floors, and the two rules in this file that fail OPEN.
 *
 * Every other rule here fails closed: it looks for something forbidden and reports it. These
 * two look for something and check it is big enough, so anything they cannot *parse* is
 * silently allowed. That asymmetry has already cost this file twice — once on units, once on
 * indirection — so each capture below is deliberately wide, and `resolveLength` decides.
 */
const MIN_FONT_PX = 12;
const MIN_TAP_PX = 32;

/**
 * Capture the whole declared value, not just a literal number: `var(...)` has to reach us.
 *
 * Both spellings, because `.ts` is linted now and CSS-in-JS writes `fontSize`. The editor
 * theme in `components/editor/blueprintHighlight.ts` styles headings from a plain object,
 * and under a kebab-only pattern it was invisible to these rules even once the file was in
 * scope. A quoted value is fine — the length is pulled out by regex, so trailing punctuation
 * does not matter.
 */
const FONT_DECL = /\b(?:font-size|fontSize)\s*:\s*([^;}\n]+)/gi;
const MIN_HEIGHT_DECL = /\b(?:min-height|minHeight)\s*:\s*([^;}\n]+)/gi;

/** `--name: value` pairs in this file, so a token used below can be looked up. */
const TOKEN_DECL = /(--[\w-]+)\s*:\s*([^;}\n]+)/g;

/** Absolute units only. `em` depends on an ancestor and cannot be resolved per-file. */
const UNIT_PX = { px: 1, rem: 16, pt: 4 / 3, in: 96, cm: 96 / 2.54, mm: 96 / 25.4 };
const LENGTH = /(-?[0-9.]+)(px|rem|pt|in|cm|mm)\b/gi;

function tokenMap(text) {
  const map = new Map();
  TOKEN_DECL.lastIndex = 0;
  let m;
  while ((m = TOKEN_DECL.exec(text)) !== null) map.set(m[1], m[2].trim());
  return map;
}

/**
 * Resolve a declared value to px, or null when it genuinely cannot be known.
 *
 * Three cases matter, and the second is the one Phase 1 would have walked into:
 *
 *   1. A literal — `17px`, `1.0625rem`.
 *   2. **A token** — `var(--tap)`. A token scale is the entire point of the redesign, and
 *      until this existed the floors saw `var(...)`, matched nothing, and reported nothing.
 *      `globals.css` already routes half its `min-height` declarations through `var(--tap)`,
 *      so setting `--tap: 20px` would have silently shrunk every control in the app.
 *   3. A function — `clamp()`, `calc()`, `min()`. The *smallest* length inside is used,
 *      because that is the worst case a floor exists to catch.
 *
 * Returns null for `em`, percentages, keywords and unresolvable tokens. Null means "not
 * judged", never "fine" — but a floor cannot report what it cannot measure, and guessing
 * would train the reader to ignore the warning.
 */
function resolveLength(raw, tokens, seen = new Set()) {
  const value = String(raw).trim();

  const varMatch = /^var\(\s*(--[\w-]+)\s*(?:,([\s\S]+))?\)$/i.exec(value);
  if (varMatch) {
    const [, name, fallback] = varMatch;
    if (seen.has(name)) return null; // a token defined in terms of itself
    seen.add(name);
    const declared = tokens.get(name);
    if (declared !== undefined) {
      const resolved = resolveLength(declared, tokens, seen);
      if (resolved !== null) return resolved;
    }
    return fallback ? resolveLength(fallback, tokens, seen) : null;
  }

  LENGTH.lastIndex = 0;
  const found = [];
  let m;
  while ((m = LENGTH.exec(value)) !== null) {
    found.push(Number.parseFloat(m[1]) * UNIT_PX[m[2].toLowerCase()]);
  }
  if (found.length === 0) return null;
  return Math.min(...found);
}

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

const files = process.argv.slice(2).filter((f) => /\.(tsx|jsx|ts|css)$/.test(f));
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

  // Tokens declared in this file, so `font-size: var(--text-sm)` can be judged on the
  // value it actually resolves to rather than waved through as unparseable.
  const tokens = tokenMap(text);
  const show = (px) => (Number.isInteger(px) ? `${px}px` : `${px.toFixed(2)}px`);

  FONT_DECL.lastIndex = 0;
  let f;
  while ((f = FONT_DECL.exec(text)) !== null) {
    const declared = (f[1] ?? "").trim();
    const px = resolveLength(declared, tokens);
    if (px === null || px >= MIN_FONT_PX) continue;
    const via = declared.startsWith("var(") ? ` (${declared} resolves to ${show(px)})` : "";
    report(
      f.index,
      "type too small",
      `${show(px)} is below the ${MIN_FONT_PX}px floor${via}. ` +
        `Small type is the complaint this design fixed.`,
    );
  }

  MIN_HEIGHT_DECL.lastIndex = 0;
  let h;
  while ((h = MIN_HEIGHT_DECL.exec(text)) !== null) {
    const declared = (h[1] ?? "").trim();
    const px = resolveLength(declared, tokens);
    if (px === null || px >= MIN_TAP_PX) continue;
    // Only complain when the declaration is plausibly on something interactive.
    const around = text.slice(Math.max(0, h.index - 400), h.index);
    if (!TAP_CONTEXT.test(around)) continue;
    const via = declared.startsWith("var(") ? ` (${declared} resolves to ${show(px)})` : "";
    report(
      h.index,
      "tap target too small",
      `${show(px)} min-height on an interactive element${via}. ` +
        `The floor is ${MIN_TAP_PX}px; the target is var(--tap).`,
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
