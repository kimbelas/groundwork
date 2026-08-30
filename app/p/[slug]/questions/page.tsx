import { QuestionsList } from "@/components/questions/QuestionsList";
import { activeRunFor, pendingRunFor } from "@/lib/runs";
import { auxMtime, getQuestions } from "@/lib/vault";

export const dynamic = "force-dynamic";

export default async function QuestionsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  /*
   * The two questions about a suggest-answers run, asked the same way the brief page asks
   * them: one that is still working, and one that finished while nobody was looking.
   *
   * `pendingRunFor` is `ready`-only and never marks these applied - there is no apply step,
   * the user clicks an option - so the newest finished run keeps being offered. That is the
   * intent: re-running the model to see output already sitting on disk would be absurd.
   */
  const [questions, mtimeMs, active, ready] = await Promise.all([
    getQuestions(slug),
    auxMtime(slug, "questions.md"),
    activeRunFor(slug, ["suggest-answers"]),
    pendingRunFor(slug, { job: ["suggest-answers"] }),
  ]);

  return (
    <QuestionsList
      slug={slug}
      initial={questions}
      initialMtimeMs={mtimeMs}
      activeRunId={active?.runId ?? null}
      readyRunId={ready?.runId ?? null}
    />
  );
}
