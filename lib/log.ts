/**
 * The decision log.
 *
 * Plain markdown rather than frontmatter, because a decision is prose and the log is
 * the file you most want readable in six months from any editor. The app only ever
 * prepends: a decision log you can rewrite is not a decision log.
 */

export interface LogEntry {
  /** `YYYY-MM-DD`, or null when the heading does not start with one. */
  date: string | null;
  title: string;
  /** Everything under the heading, verbatim. */
  body: string;
}

const HEADING = /^##\s+(.*)$/;
const DATED = /^(\d{4}-\d{2}-\d{2})\s*(?:[—–-]\s*)?(.*)$/;

export function parseLog(text: string): LogEntry[] {
  const lines = text.split("\n");
  const entries: LogEntry[] = [];

  let current: { title: string; body: string[] } | null = null;

  const flush = () => {
    if (!current) return;
    const m = DATED.exec(current.title);
    entries.push({
      date: m?.[1] ?? null,
      title: (m?.[2] ?? current.title).trim(),
      body: current.body.join("\n").trim(),
    });
    current = null;
  };

  for (const raw of lines) {
    const line = raw.replace(/\r$/, "");
    const heading = HEADING.exec(line);
    if (heading) {
      flush();
      current = { title: (heading[1] ?? "").trim(), body: [] };
      continue;
    }
    if (current) current.body.push(line);
  }
  flush();

  return entries;
}

export interface NewDecision {
  date: string;
  title: string;
  considered: string;
  because: string;
}

/**
 * Render a decision in the log's house format.
 *
 * "Considered" and "Because" are separate fields on purpose. A decision recorded
 * without its alternatives reads, later, as though nothing else was ever on the table —
 * which is exactly the context you go back to the log for.
 */
export function formatDecision(input: NewDecision): string {
  const parts = [`## ${input.date} — ${input.title.trim()}`];

  if (input.considered.trim()) {
    parts.push("", `**Considered:** ${input.considered.trim()}`);
  }
  if (input.because.trim()) {
    parts.push("", `**Because:** ${input.because.trim()}`);
  }

  return parts.join("\n");
}
