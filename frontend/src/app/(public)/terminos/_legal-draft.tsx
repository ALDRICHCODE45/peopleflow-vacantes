import * as React from "react";
import Link from "next/link";
import { FileWarningIcon } from "lucide-react";
import { PeopleFlowLogo } from "@/components/brand/logo";

/** L23: shown on top of both provisional legal pages until the real texts are published. */
export const LEGAL_DRAFT_NOTICE = "Texto provisional: el texto legal definitivo se publicará antes del lanzamiento.";

const LINK_CLASS = "inline-flex min-h-11 items-center rounded-md px-1 font-medium text-foreground underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

/**
 * Provisional legal page (L23): a draft banner and a neutral heading structure
 * only. No clause text on purpose: nothing here may read as a legal
 * obligation until the definitive text replaces it before launch. The (public)
 * group adds no chrome, so the page owns its main landmark.
 */
export function LegalDraftPage({ title, sections, other }: { title: string; sections: readonly string[]; other: { label: string; href: string } }) {
  return (
    <main className="min-h-dvh bg-background px-6 py-10 sm:px-10">
      <div className="mx-auto w-full max-w-prose">
        <Link href="/" className="mb-8 inline-flex min-h-11 items-center rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
          <PeopleFlowLogo className="h-7 w-auto" />
        </Link>
        <div role="note" className="mb-8 flex items-start gap-2.5 rounded-xl border border-status-review/40 bg-status-review/10 px-4 py-3 text-[14px] font-medium text-foreground">
          <FileWarningIcon aria-hidden="true" className="mt-0.5 size-[18px] shrink-0 text-status-review" />
          <p>{LEGAL_DRAFT_NOTICE}</p>
        </div>
        <h1 className="font-heading text-[32px] font-bold tracking-tight text-foreground">{title}</h1>
        <div className="mt-8 flex flex-col gap-6">
          {sections.map((heading) => (
            <section key={heading} aria-labelledby={`legal-${heading}`}>
              <h2 id={`legal-${heading}`} className="font-heading text-xl font-semibold text-foreground">{heading}</h2>
            </section>
          ))}
        </div>
        <nav aria-label="Legal" className="mt-12 flex flex-wrap gap-x-6 text-[14px]">
          <Link href={other.href} className={LINK_CLASS}>{other.label}</Link>
          <Link href="/" className={LINK_CLASS}>Volver al inicio</Link>
        </nav>
      </div>
    </main>
  );
}
