import { QuestionsList } from "@/components/questions/QuestionsList";
import { auxMtime, getQuestions } from "@/lib/vault";

export const dynamic = "force-dynamic";

export default async function QuestionsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  const [questions, mtimeMs] = await Promise.all([
    getQuestions(slug),
    auxMtime(slug, "questions.md"),
  ]);

  return <QuestionsList slug={slug} initial={questions} initialMtimeMs={mtimeMs} />;
}
