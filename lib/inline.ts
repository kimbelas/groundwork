/**
 * Minimal inline-markdown tokenizer for displaying vault prose.
 *
 * Deliberately not a markdown-to-HTML pipeline. The text shown here can originate from
 * an AI proposal the user accepted, so rendering it as raw HTML would mean a model's
 * output reaching `dangerouslySetInnerHTML`. Returning tokens for the caller to render
 * as React elements makes injection structurally impossible rather than merely
 * sanitised — there is no HTML string anywhere in the path.
 *
 * Handles the emphasis the vault's own formats actually use: `**strong**`, `*em*`, and
 * `` `code` ``. Anything else stays literal text, which is the honest outcome for a
 * viewer that does not claim to be a full renderer.
 */

export type InlineToken =
  | { type: "text"; value: string }
  | { type: "strong"; value: string }
  | { type: "em"; value: string }
  | { type: "code"; value: string };

// Order matters: `**` must be tried before `*`, or strong parses as two empty ems.
const PATTERNS: { type: InlineToken["type"]; re: RegExp }[] = [
  { type: "code", re: /^`([^`\n]+)`/ },
  { type: "strong", re: /^\*\*([^*\n]+)\*\*/ },
  { type: "em", re: /^\*([^*\n]+)\*/ },
];

export function parseInline(text: string): InlineToken[] {
  const tokens: InlineToken[] = [];
  let literal = "";
  let i = 0;

  const flush = () => {
    if (literal) {
      tokens.push({ type: "text", value: literal });
      literal = "";
    }
  };

  while (i < text.length) {
    const rest = text.slice(i);
    let matched = false;

    for (const { type, re } of PATTERNS) {
      const m = re.exec(rest);
      if (!m?.[1]) continue;
      flush();
      tokens.push({ type, value: m[1] });
      i += m[0].length;
      matched = true;
      break;
    }

    if (!matched) {
      literal += text[i] ?? "";
      i += 1;
    }
  }

  flush();
  return tokens;
}
