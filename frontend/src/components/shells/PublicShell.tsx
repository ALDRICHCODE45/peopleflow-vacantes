import * as React from "react";
import Link from "next/link";
import { PeopleFlowLogo } from "../brand/logo";

const focusRing =
  "rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

// Shared page container: one width/padding rhythm for header, main, and footer,
// inherited by the root and future vacancy routes.
const shellContainer = "mx-auto w-full max-w-6xl px-4 md:px-6";

export function PublicShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex min-h-dvh flex-col">
      {/* Static ambient depth behind every public route: a violet top glow and
          a masked dot grid, both driven by the semantic --primary token so
          they stay theme-aware. Purely decorative and inert. */}
      <div
        aria-hidden="true"
        className="pf-top-glow pointer-events-none fixed inset-0 z-0"
      />
      <div
        aria-hidden="true"
        className="pf-dot-grid pointer-events-none fixed inset-x-0 top-0 z-0 h-[520px]"
      />
      <div className="relative z-10 flex min-h-dvh flex-col">
        <header className="sticky top-0 z-30 border-b border-border/70 bg-background/70 backdrop-blur-xl">
          <div
            className={`${shellContainer} flex h-16 items-center justify-between gap-4`}
          >
            <Link href="/" aria-label="PeopleFlow" className={focusRing}>
              <PeopleFlowLogo />
            </Link>
            <nav aria-label="Navegación principal">
              {/* Truthful public navigation only: the brand entry point and the
                  vacancy board. No auth, publish, legal, or theme actions. A
                  quiet opaque surface/foreground hit target keeps the
                  AA-checked token pair measured by the root contrast test. */}
              <Link
                href="/vacantes"
                className={`${focusRing} inline-flex items-center rounded-md bg-background px-4 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-accent hover:text-accent-foreground`}
              >
                Vacantes
              </Link>
            </nav>
          </div>
        </header>
        <main className={`${shellContainer} flex-1 py-10 md:py-12`}>
          {children}
        </main>
        <footer className="border-t border-border/70">
          <div
            className={`${shellContainer} py-6 text-sm text-muted-foreground`}
          >
            PeopleFlow · Encuentra tu próxima oportunidad profesional.
          </div>
        </footer>
      </div>
    </div>
  );
}
