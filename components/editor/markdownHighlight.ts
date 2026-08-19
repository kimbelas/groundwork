import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import type { Extension } from "@codemirror/state";
import { tags as t } from "@lezer/highlight";

/**
 * Markdown highlighting, in the app's own terms.
 *
 * CodeMirror's stock highlight style paints keywords and links in its own palette —
 * including a blue-violet that lands squarely in the hue band the design forbids. More
 * to the point, rainbow-coloured prose contradicts the rule that color is data: the
 * five status hues mean something, and nothing else in the interface is tinted.
 *
 * So structure is expressed through weight, face and the single accent instead:
 * headings step up in weight and size, links take the accent, and everything else is
 * plain ink. They used to step into a serif display face; that face is gone, and this
 * file was the one reference to it that no lint rule could reach at the time.
 */
const style = HighlightStyle.define([
  {
    tag: t.heading,
    fontWeight: "600",
    color: "var(--ink)",
  },
  { tag: t.heading1, fontSize: "1.35em" },
  { tag: t.heading2, fontSize: "1.2em" },
  { tag: t.heading3, fontSize: "1.08em" },

  { tag: t.strong, fontWeight: "600", color: "var(--ink)" },
  { tag: t.emphasis, fontStyle: "italic", color: "var(--ink)" },
  { tag: t.strikethrough, textDecoration: "line-through", color: "var(--ink-soft)" },

  { tag: [t.link, t.url], color: "var(--accent)" },
  { tag: [t.monospace, t.literal], color: "var(--ink-soft)" },
  { tag: t.quote, color: "var(--ink-soft)", fontStyle: "italic" },

  // Structural punctuation recedes rather than competing with the prose.
  { tag: [t.processingInstruction, t.labelName, t.meta], color: "var(--ink-faint)" },
  { tag: t.list, color: "var(--ink)" },

  // Anything the markdown parser tags but the list above does not name stays plain ink,
  // so a future CodeMirror release cannot introduce a new colour behind our back.
  { tag: [t.keyword, t.atom, t.bool, t.number, t.string, t.variableName, t.typeName, t.propertyName, t.comment, t.operator, t.punctuation], color: "var(--ink)" },
]);

export const markdownHighlight: Extension = syntaxHighlighting(style);
