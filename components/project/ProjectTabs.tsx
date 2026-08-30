"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { Badge } from "@/components/ui/Badge";
import { openQuestionsLabel } from "@/lib/labels";

const VIEWS = [
  { seg: "brief", label: "Brief" },
  { seg: "board", label: "Board" },
  { seg: "roadmap", label: "Roadmap" },
  { seg: "log", label: "Log" },
  { seg: "questions", label: "Questions" },
  /*
     Everything about the project that is not the plan: the connected repository, export, and
     deleting it. These sat at the foot of the Brief, where they pushed the AI panel into the
     middle of a long scroll and had nothing to do with the document above them.

     Named "Settings" like the app-level page in the rail. Two links of that name exist on a
     project page as a result, so a locator has to be scoped - this nav carries
     `aria-label="Project views"` for exactly that.
  */
  { seg: "settings", label: "Settings" },
] as const;

/**
 * Text tabs with an accent underline — not pills, not a segmented control.
 * A client component only because the active tab depends on the current path.
 */
export function ProjectTabs({ slug, openQuestions }: { slug: string; openQuestions: number }) {
  const pathname = usePathname();

  return (
    <nav className="tabs" aria-label="Project views">
      {VIEWS.map(({ seg, label }) => {
        const href = `/p/${slug}/${seg}`;
        // A card's page lives under the board, so the Board tab stays lit there.
        const active =
          pathname === href || (seg === "board" && pathname.startsWith(`/p/${slug}/cards/`));
        return (
          <Link key={seg} href={href} className="tab" aria-current={active ? "page" : undefined}>
            {label}
            {seg === "questions" && openQuestions > 0 && (
              <Badge label={openQuestionsLabel(openQuestions)}>{openQuestions}</Badge>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
