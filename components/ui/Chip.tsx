import type { Tone } from "@/lib/format";

const TONE_CLASS: Record<Tone, string> = {
  idea: "chip-idea",
  active: "chip-active",
  blocked: "chip-blocked",
  done: "chip-done",
  paused: "chip-paused",
};

export function Chip({
  tone,
  hollow = false,
  children,
}: {
  tone: Tone;
  hollow?: boolean;
  children: React.ReactNode;
}) {
  return (
    <span className={`chip ${TONE_CLASS[tone]}${hollow ? " chip-hollow" : ""}`}>{children}</span>
  );
}
