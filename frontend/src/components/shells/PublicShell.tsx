import * as React from "react";
import Link from "next/link";
import { PeopleFlowLogo } from "../brand/logo";

const focusRing =
  "rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

export function PublicShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-b border-border">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-4 px-4 py-3">
          <Link href="/" aria-label="PeopleFlow" className={focusRing}>
            <PeopleFlowLogo />
          </Link>
          <nav aria-label="Navegación principal">
            {/* Primary pill: the preset dark --primary fails AA as small text
                (2.15:1), but the --primary/--primary-foreground pair passes
                in both schemes, so the token pair is used as designed. */}
            <Link
              href="/vacantes"
              className={`${focusRing} inline-flex items-center rounded-md bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90`}
            >
              Vacantes
            </Link>
          </nav>
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-10">
        {children}
      </main>
      <footer className="border-t border-border">
        <div className="mx-auto w-full max-w-5xl px-4 py-6 text-sm text-muted-foreground">
          PeopleFlow · Encuentra tu próxima oportunidad profesional.
        </div>
      </footer>
    </div>
  );
}
