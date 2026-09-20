"use client";

import * as React from "react";
import Link from "next/link";

import { PeopleFlowLogo } from "@/components/brand/logo";
import { ThemeToggle } from "@/components/theme/theme-toggle";

export type NavbarMode = "candidate" | "marketing";

// Shared layout constants matching PublicShell's reference geometry
const containerClass = "mx-auto w-full max-w-6xl px-6";
const focusRing =
  "rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

const CandidateNavbar = React.memo(function CandidateNavbar() {
  return (
    <header className="sticky top-0 z-30 border-b border-border/70 bg-background/70 backdrop-blur-xl">
      <div className={`${containerClass} flex h-16 items-center gap-6`}>
        {/* Brand */}
        <Link href="/" aria-label="PeopleFlow" className={`${focusRing} shrink-0`}>
          <PeopleFlowLogo className="h-6 w-auto" />
        </Link>

        {/* Candidate mode: single Vacantes reference nav link */}
        <nav aria-label="Navegación principal">
          <Link
            href="/vacantes"
            className={`${focusRing} text-sm font-medium text-muted-foreground transition-colors hover:text-foreground`}
          >
            Vacantes
          </Link>
        </nav>

        <div className="ml-auto flex items-center gap-3">
          <ThemeToggle className="size-11 rounded-lg" />
        </div>
      </div>
    </header>
  );
});

// Marketing nav mirrors design/landing-preview exactly: full-width sticky
// header, brand + the Vacantes entry point + four product links, a quiet login
// link, the shared theme control and one primary CTA. The reference has no
// mobile sheet, so there is no hamburger here. Only Vacantes is a real route;
// the four product links stay non-operational prototype placeholders.
const MARKETING_NAV_LINKS = [
  // Candidate entry point: the only real destination in this nav.
  { label: "Vacantes", href: "/vacantes" },
  { label: "Producto", href: "#" },
  { label: "Soluciones", href: "#" },
  { label: "Precios", href: "#" },
  { label: "Recursos", href: "#" },
] as const;

const MarketingNavbar = React.memo(function MarketingNavbar() {
  return (
    <header
      id="nav"
      data-pf-marketing-navbar=""
      className="sticky top-0 z-50 border-b border-transparent backdrop-blur-md transition-colors duration-300"
    >
      <nav className="mx-auto flex max-w-[1280px] items-center justify-between px-8 py-5">
        <div className="flex items-center gap-10">
          <Link href="/" aria-label="PeopleFlow" className="select-none">
            <PeopleFlowLogo className="h-7 w-auto" />
          </Link>
          <ul className="hidden items-center gap-8 text-[15px] text-muted md:flex">
            {MARKETING_NAV_LINKS.map((link) => (
              <li key={link.label}>
                <Link href={link.href} className="transition hover:text-ink">
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
        <div className="flex items-center gap-4">
          <Link
            href="#"
            className="hidden text-[15px] text-muted transition hover:text-ink sm:block"
          >
            Iniciar sesión
          </Link>
          <ThemeToggle className="size-9 rounded-lg border-line bg-surface/40 text-muted hover:border-brand/60 hover:bg-surface/60 hover:text-ink" />
          <Link
            href="#"
            className="btn btn-primary rounded-xl bg-brand px-5 py-2.5 text-[14px] font-semibold text-white"
          >
            Empezar gratis
          </Link>
        </div>
      </nav>
    </header>
  );
});

/**
 * Shared PeopleFlow navbar.
 *
 * - `candidate` mode: brand + single Vacantes link + theme toggle.
 *   No hamburger, no extra CTAs, no mobile menu.
 *
 * - `marketing` mode: the reference landing header (brand + Vacantes +
 *   Producto / Soluciones / Precios / Recursos + Iniciar sesión + theme toggle
 *   + Empezar gratis). Only Vacantes is a real route; the rest stay `#`.
 *
 * Both modes share the same theme control. The component is a client boundary
 * because ThemeToggle is a client leaf; the static landing content remains
 * outside this client boundary.
 */
export function PeopleFlowNavbar({ mode = "candidate" }: { mode?: NavbarMode }) {
  if (mode === "marketing") {
    return <MarketingNavbar />;
  }
  return <CandidateNavbar />;
}
