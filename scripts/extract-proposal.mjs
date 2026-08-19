#!/usr/bin/env node
/**
 * Recover a proposal from a run's raw transcript.
 *
 * A diagnostic, not part of the app. When a run composes a valid proposal but fails to
 * save it — a denied Write, a crash after the model finished — the content is still in
 * `stdout.log`, and re-running costs minutes and tokens to get back something already
 * paid for. This digs it out so the output can still be judged.
 *
 * Usage: node scripts/extract-proposal.mjs <path-to-stdout.log> [out.json]
 */
import fs from "node:fs";

const [, , logPath, outPath] = process.argv;
if (!logPath) {
  console.error("usage: node scripts/extract-proposal.mjs <stdout.log> [out.json]");
  process.exit(2);
}

const raw = fs.readFileSync(logPath, "utf8");

/**
 * The transcript is JSONL of stream events; assistant text arrives as JSON strings, so a
 * proposal inside it is double-encoded. Parsing each line and walking the text fields is
 * far more reliable than trying to unescape the whole file with regexes.
 */
function candidateTexts(text) {
  const out = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    let event;
    try {
      event = JSON.parse(trimmed);
    } catch {
      continue;
    }

    const visit = (node) => {
      if (typeof node === "string") {
        out.push(node);
        return;
      }
      if (Array.isArray(node)) {
        node.forEach(visit);
        return;
      }
      if (node && typeof node === "object") {
        Object.values(node).forEach(visit);
      }
    };
    visit(event);
  }
  return out;
}

/** Every balanced `{...}` starting at a `{"runId"` or `{ "runId"`. */
function jsonObjects(text) {
  const found = [];
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] !== "{") continue;
    const ahead = text.slice(i, i + 40);
    if (!/^\{\s*"(runId|job|slug|summary)"/.test(ahead)) continue;

    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let j = i; j < text.length; j += 1) {
      const ch = text[j];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === "\\") {
        escaped = true;
        continue;
      }
      if (ch === '"') inString = !inString;
      if (inString) continue;
      if (ch === "{") depth += 1;
      else if (ch === "}") {
        depth -= 1;
        if (depth === 0) {
          found.push(text.slice(i, j + 1));
          i = j;
          break;
        }
      }
    }
  }
  return found;
}

let best = null;
for (const text of candidateTexts(raw)) {
  for (const candidate of jsonObjects(text)) {
    let parsed;
    try {
      parsed = JSON.parse(candidate);
    } catch {
      continue;
    }
    const looksLikeProposal =
      parsed && typeof parsed === "object" && ("cards" in parsed || "questions" in parsed);
    if (!looksLikeProposal) continue;
    if (!best || candidate.length > best.length) best = candidate;
  }
}

if (!best) {
  console.error("No parseable proposal found in that transcript.");
  process.exit(1);
}

const proposal = JSON.parse(best);
const count = (k) => (Array.isArray(proposal[k]) ? proposal[k].length : 0);

console.log("Recovered a proposal.");
console.log(`  job:         ${proposal.job ?? "?"}`);
console.log(`  phases:      ${count("phases")}`);
console.log(`  cards:       ${count("cards")}`);
console.log(`  questions:   ${count("questions")}`);
console.log(`  risks:       ${count("risks")}`);
console.log(`  assumptions: ${count("assumptions")}`);

if (outPath) {
  fs.writeFileSync(outPath, JSON.stringify(proposal, null, 2), "utf8");
  console.log(`  written to:  ${outPath}`);
}
