import { phaseNumbers } from "@/lib/phases";
import type { CardMeta, Phase } from "@/lib/schema";

/**
 * Phases with the cards assigned to them.
 *
 * Read-only on purpose: a card's phase is edited in the card detail pane, so there is
 * one place that changes it rather than two that can disagree.
 *
 * Phase and column are independent axes — phase is *when in the plan*, column is *where
 * in the workflow right now* — so a card appears here regardless of how far along the
 * board it has moved.
 */
export function PhaseTrack({
  phases,
  cards,
  doneColumn,
}: {
  phases: Phase[];
  cards: CardMeta[];
  doneColumn: string | undefined;
}) {
  const unphased = cards.filter((c) => c.phase === null);

  /**
   * Lanes come from the declared phases *and* from every phase number a card references.
   * A card assigned to phase 3 when roadmap.md declares none would otherwise vanish from
   * this view entirely — present on the board, invisible here.
   *
   * The rule moved to `lib/phases.ts` because the card detail pane needs the same answer.
   * It used to be worked out here and hard-coded there as 1 to 8, which is exactly how two
   * views come to disagree about what exists. An undeclared number still gets a synthesised
   * lane, since it has no name or goal to show.
   */
  const byNumber = new Map(phases.map((p) => [p.n, p]));
  const allPhases = phaseNumbers(phases, cards).map(
    (n): Phase => byNumber.get(n) ?? { n, name: `Phase ${n}`, goal: "" },
  );

  if (allPhases.length === 0 && unphased.length === 0) {
    return (
      <div className="empty" data-testid="phase-track">
        <p className="display-sm" style={{ margin: "0 0 6px" }}>
          No phases yet
        </p>
        <p className="body-sm" style={{ margin: 0 }}>
          Synthesis proposes phases from the brief, or add them to{" "}
          <code className="mono">roadmap.md</code> by hand.
        </p>
      </div>
    );
  }

  const lanes = [
    ...allPhases.map((p) => ({
      key: `p${p.n}`,
      label: `${p.n}`,
      name: p.name,
      goal: p.goal,
      cards: cards.filter((c) => c.phase === p.n),
    })),
    ...(unphased.length > 0
      ? [{ key: "unphased", label: "—", name: "Unphased", goal: "", cards: unphased }]
      : []),
  ];

  return (
    <div className="track scroll-x" data-testid="phase-track">
      {lanes.map((lane) => {
        const done = doneColumn ? lane.cards.filter((c) => c.column === doneColumn).length : 0;
        return (
          <section key={lane.key} className="phase" aria-label={lane.name}>
            <header className="phase-head">
              <span className="phase-number" aria-hidden="true">
                {lane.label}
              </span>
              <span className="phase-name">{lane.name}</span>
              <span className="column-count" data-testid={`phase-count-${lane.key}`}>
                {done}/{lane.cards.length}
              </span>
            </header>

            {lane.goal && <p className="body-sm soft phase-goal">{lane.goal}</p>}

            {lane.cards.length === 0 ? (
              <p className="body-sm faint" style={{ padding: "0 12px 12px" }}>
                No cards in this phase.
              </p>
            ) : (
              <ul className="phase-cards">
                {lane.cards.map((c) => (
                  <li key={c.id} data-testid={`phase-card-${c.id}`}>
                    <span className={c.column === doneColumn ? "faint" : undefined}>
                      {c.title}
                    </span>
                    <span className="mono faint"> {c.column}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}
