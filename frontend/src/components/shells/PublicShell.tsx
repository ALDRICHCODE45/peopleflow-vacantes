import * as React from "react";

import { PeopleFlowNavbar } from "../navigation/PeopleFlowNavbar";

// Shared page container: one width/padding rhythm for main and footer,
// inherited by the root and every vacancy route.
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
        {/* The header is delegated to the shared navbar so the floating
            capsule stays identical across public browsing routes. */}
        <PeopleFlowNavbar mode="public" />
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
