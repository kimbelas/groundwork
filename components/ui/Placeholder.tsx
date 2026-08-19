/**
 * Stub for a view that a later phase fills in. Named honestly and dated to its phase so
 * nobody mistakes an unbuilt screen for a broken one.
 */
export function Placeholder({ view, phase }: { view: string; phase: number }) {
  return (
    <div className="empty">
      <p className="display-sm" style={{ margin: "0 0 6px" }}>
        {view} arrives in phase {phase}
      </p>
      <p className="body-sm" style={{ margin: 0 }}>
        See <code className="mono">docs/06-roadmap.md</code>.
      </p>
    </div>
  );
}
