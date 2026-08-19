"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const VIEWS = [
  { seg: "brief", label: "Brief" },
  { seg: "board", label: "Board" },
  { seg: "roadmap", label: "Roadmap" },
  { seg: "log", label: "Log" },
  { seg: "questions", label: "Questions" },
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
        const active = pathname === href;
        return (
          <Link key={seg} href={href} className="tab" aria-current={active ? "page" : undefined}>
            {label}
            {seg === "questions" && openQuestions > 0 && (
              <span className="tab-badge mono" aria-label={`${openQuestions} open`}>
                {openQuestions}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
