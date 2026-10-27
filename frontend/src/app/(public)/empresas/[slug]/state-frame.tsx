import type { ReactNode } from "react";
import Link from "next/link";
import { PeopleFlowLogo } from "@/components/brand/logo";

/** Standalone route states own their landmark; published sites supply their own chrome. */
export function CompanySiteStateFrame({ children }: { children: ReactNode }) {
  return (
    <main id="contenido" className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-background px-4 py-12 text-foreground sm:px-6">
      <Link
        href="/"
        aria-label="PeopleFlow"
        className="inline-flex min-h-10 items-center rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        <PeopleFlowLogo className="h-5 w-auto" />
      </Link>
      <div className="w-full max-w-xl">{children}</div>
    </main>
  );
}
