import { parseInline } from "@/lib/inline";

/**
 * Renders vault prose with its inline emphasis, as React elements.
 *
 * Note what this deliberately does not do: build an HTML string. The text here can come
 * from an AI proposal the user accepted, so a markdown-to-HTML pipeline would put model
 * output through `dangerouslySetInnerHTML`. Tokens rendered as elements make injection
 * structurally impossible rather than merely filtered.
 */
export function Prose({ text, className }: { text: string; className?: string }) {
  const tokens = parseInline(text);

  return (
    <p className={className} style={{ whiteSpace: "pre-wrap" }}>
      {tokens.map((token, i) => {
        const key = `${token.type}-${i}`;
        switch (token.type) {
          case "strong":
            return <strong key={key}>{token.value}</strong>;
          case "em":
            return <em key={key}>{token.value}</em>;
          case "code":
            return (
              <code key={key} className="mono">
                {token.value}
              </code>
            );
          case "text":
            return <span key={key}>{token.value}</span>;
        }
      })}
    </p>
  );
}
