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
            <Link
              href="/vacantes"
              className={`${focusRing} text-sm font-medium text-primary underline-offset-4 hover:underline`}
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
