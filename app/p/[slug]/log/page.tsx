import { DecisionLog } from "@/components/log/DecisionLog";
import { RiskRegister } from "@/components/risks/RiskRegister";
import { parseLog } from "@/lib/log";
import { auxMtime, getLog, getRisks } from "@/lib/vault";

export const dynamic = "force-dynamic";

/**
 * The log tab carries both the decision log and the risk register: they are the two
 * places a project records what it believes, as opposed to what it is doing.
 */
export default async function LogPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  const [log, risks, risksMtime] = await Promise.all([
    getLog(slug),
    getRisks(slug),
    auxMtime(slug, "risks.md"),
  ]);

  return (
    <div className="stack" style={{ gap: 30, maxWidth: 760 }}>
      <DecisionLog slug={slug} entries={parseLog(log)} />
      <hr className="rule rule-strong" />
      <RiskRegister
        slug={slug}
        risks={risks.risks}
        assumptions={risks.assumptions}
        initialMtimeMs={risksMtime}
      />
    </div>
  );
}
