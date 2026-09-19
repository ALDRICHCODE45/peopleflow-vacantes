import * as React from "react";
import Link from "next/link";

import { PROTOTYPE_COMPANY_ID } from "../../features/company-profile/model";
import { PeopleFlowLogo } from "../brand/logo";
import { ThemeToggle } from "../theme/theme-toggle";
import { buttonVariants } from "../ui/button";

const focusRing =
  "rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

// Shared page container: one width/padding rhythm for header, main, and footer,
// inherited by the root and future vacancy routes.
const shellContainer = "mx-auto w-full max-w-6xl px-4 md:px-6";

// Every plain-text header link owns the same layout: a >=40px pointer target
// (min-h-10) with vertical centering, so text height is never the hit box.
const navTarget = "inline-flex min-h-10 items-center";

// Quiet nav item: muted by default, foreground on hover, so the public
// destinations share one honest resting/hover pair.
const navItem =
  "text-muted-foreground transition-colors hover:text-foreground";

// Empresas points at the canonical prototype company microsite already owned
// by the company-profile model, so the header never invents a route.
const EMPRESAS_HREF = `/empresas/${PROTOTYPE_COMPANY_ID}`;

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
          <div className={`${shellContainer} flex h-16 items-center gap-6`}>
            <Link
              href="/"
              aria-label="PeopleFlow"
              className={`${focusRing} ${navTarget} shrink-0`}
            >
              <PeopleFlowLogo className="h-6 w-auto" />
            </Link>
            {/* Desktop destinations only: hidden below md so the 375px header
                keeps logo, theme control, and one compact publish CTA. */}
            <nav
              aria-label="Navegación principal"
              className="ml-2 hidden items-center gap-6 text-sm md:flex"
            >
              <Link
                href="/vacantes"
                className={`${focusRing} ${navTarget} font-semibold text-foreground transition-colors hover:text-foreground`}
              >
                Vacantes
              </Link>
              <Link
                href={EMPRESAS_HREF}
                className={`${focusRing} ${navTarget} ${navItem}`}
              >
                Empresas
              </Link>
              {/* Visual prototype affordance: no invented resource route. */}
              <Link
                href="#recursos"
                title="Próximamente"
                className={`${focusRing} ${navTarget} ${navItem}`}
              >
                Recursos
              </Link>
            </nav>
            <div className="ml-auto flex items-center gap-3">
              <ThemeToggle className="size-10 rounded-lg" />
              {/* Hidden at tight mobile via a variant-scoped display rule, so
                  no competing base display utility can defeat the hide. */}
              <Link
                href="/candidato/login"
                className={`${focusRing} ${navTarget} ${navItem} text-sm max-sm:hidden`}
              >
                Ingresar
              </Link>
              <Link
                href="/empresa/vacantes/nueva"
                className={buttonVariants({ size: "lg" })}
              >
                Publicar vacante
              </Link>
            </div>
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
