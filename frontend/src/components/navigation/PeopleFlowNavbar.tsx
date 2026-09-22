"use client";

import * as React from "react";
import Link from "next/link";
import { cn } from "cn";

import { PeopleFlowLogo } from "@/components/brand/logo";
import { IngresarMenu } from "@/components/navigation/IngresarMenu";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { buttonVariants } from "@/components/ui/button";
import { PROTOTYPE_COMPANY_ID } from "@/features/company-profile/model";

export type NavbarMode = "candidate" | "marketing" | "public";

// Shared layout constants matching PublicShell's reference geometry
const containerClass = "mx-auto w-full max-w-6xl px-6";
const focusRing =
  "rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

// Public header links own the same >=40px pointer target as the shell's old
// inline bar, so text height is never the hit box.
const navTarget = "inline-flex min-h-10 items-center";

// One detached floating capsule shared by the marketing landing and every
// public browsing route. The sticky outer shell owns positioning (and, in
// marketing, the `.scrolled` state class); the inner surface owns the detached
// frame. Border/background/depth use semantic Tailwind defaults so the capsule
// reads correctly outside `.pf-reference-landing`, while the landing's more
// specific scoped CSS may still retune those tokens.
const floatingShellClass =
  "pointer-events-none sticky top-0 z-50 px-3 pt-3 sm:px-6 sm:pt-4";
const floatingSurfaceClass =
  "pointer-events-auto mx-auto flex max-w-[1280px] items-center justify-between rounded-2xl border border-border/80 bg-background/70 px-3 py-2.5 shadow-lg backdrop-blur-md transition-colors duration-300 sm:px-5 sm:py-3";

// Empresas points at the canonical prototype company microsite already owned
// by the company-profile model, so the header never invents a route.
const EMPRESAS_HREF = `/empresas/${PROTOTYPE_COMPANY_ID}`;

// Quiet public nav item: muted by default, foreground on hover, so the browsed
// destinations share one honest resting/hover pair.
const publicNavItem =
  "text-muted-foreground transition-colors hover:text-foreground";

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

// Marketing nav: only destinations that really exist are listed. `Vacantes` is
// the real board route; `Producto` and `Soluciones` point at sections that are
// rendered by the landing itself, and the primary CTA jumps to the closing
// section. Unsupported placeholder entries are intentionally absent until
// truthful content exists, so no fake link survives here.
const MARKETING_NAV_LINKS = [
  { label: "Vacantes", href: "/vacantes" },
  { label: "Producto", href: "#producto" },
  { label: "Soluciones", href: "#soluciones" },
] as const;

// In-page targets stay plain anchors: the browser owns the hash jump and the
// section `scroll-margin`, so the router never has to emulate anchor scrolling.
const marketingLinkClass = "transition hover:text-ink";

const MarketingNavbar = React.memo(function MarketingNavbar() {
  return (
    <header id="nav" data-pf-marketing-navbar="" className={floatingShellClass}>
      {/* Detached floating capsule: the sticky shell above owns positioning and
          the `scrolled` state class while this inner surface owns the visual
          treatment, so the header can breathe on every side. */}
      <nav
        data-pf-nav-floating=""
        className={floatingSurfaceClass}
      >
        <div className="flex items-center gap-10">
          <Link
            href="/"
            aria-label="PeopleFlow"
            className="shrink-0 select-none"
          >
            <PeopleFlowLogo className="h-7 w-auto" />
          </Link>
          <ul className="hidden items-center gap-8 text-[15px] text-muted md:flex">
            {MARKETING_NAV_LINKS.map((link) => (
              <li key={link.label}>
                {link.href.startsWith("#") ? (
                  <a href={link.href} className={marketingLinkClass}>
                    {link.label}
                  </a>
                ) : (
                  <Link href={link.href} className={marketingLinkClass}>
                    {link.label}
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </div>
        <div className="flex items-center gap-1.5 sm:gap-4">
          <IngresarMenu className="text-[15px] font-normal text-muted hover:text-ink" />
          <ThemeToggle className="size-9 rounded-lg border-line bg-surface/40 text-muted hover:border-brand/60 hover:bg-surface/60 hover:text-ink" />
          <a
            href="#empezar"
            className="btn btn-primary whitespace-nowrap rounded-xl bg-brand px-3 py-2.5 text-[13px] font-semibold text-white sm:px-5 sm:text-[14px]"
          >
            Empezar gratis
          </a>
        </div>
      </nav>
    </header>
  );
});

// Public mode reuses the marketing capsule for every browsing route rendered
// through `PublicShell` (board, canonical detail, company careers). Only
// destinations that really exist are listed: the brand home, the board, the
// canonical prototype company, the shared Ingresar menu, the shared theme
// control, and the publish CTA. The unsupported `Recursos` placeholder is gone
// entirely, so every public anchor leads somewhere real.
const PublicNavbar = React.memo(function PublicNavbar() {
  return (
    <header data-pf-public-navbar="" className={floatingShellClass}>
      <nav
        data-pf-nav-floating=""
        aria-label="Navegación principal"
        className={floatingSurfaceClass}
      >
        <div className="flex items-center gap-6 sm:gap-10">
          <Link
            href="/"
            aria-label="PeopleFlow"
            className={`${focusRing} ${navTarget} shrink-0 select-none`}
          >
            <PeopleFlowLogo className="h-6 w-auto" />
          </Link>
          {/* Desktop destinations only: hidden below md so the 375px capsule
              keeps brand, Ingresar, theme, and the publish CTA reachable. A
              plain flex group (no `list` role) keeps the board's own list
              landmark unique for assistive tech and tests. */}
          <div
            data-pf-public-nav-links=""
            className="hidden items-center gap-6 text-sm md:flex"
          >
            <Link
              href="/vacantes"
              className={`${focusRing} ${navTarget} font-semibold text-foreground transition-colors hover:text-foreground`}
            >
              Vacantes
            </Link>
            <Link
              href={EMPRESAS_HREF}
              className={`${focusRing} ${navTarget} ${publicNavItem}`}
            >
              Empresas
            </Link>
          </div>
        </div>
        <div className="flex items-center gap-1.5 sm:gap-3">
          {/* Shared dual-login menu: one visible trigger for both audiences. */}
          <IngresarMenu className={focusRing} />
          <ThemeToggle className="size-10 rounded-lg" />
          {/* Below sm the CTA compacts its padding/typography, never its label,
              so the public capsule fits 375px without overflow. */}
          <Link
            href="/empresa/vacantes/nueva"
            className={cn(
              buttonVariants({ size: "lg" }),
              "max-sm:px-2.5 max-sm:text-[13px]",
            )}
          >
            Publicar vacante
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
 * - `marketing` mode: the detached floating capsule inside the sticky `#nav`
 *   shell, carrying the brand, `Vacantes` -> `/vacantes`, the in-page
 *   `Producto` -> `#producto` and `Soluciones` -> `#soluciones` anchors, the
 *   shared Ingresar menu, the shared theme control, and the primary
 *   `Empezar gratis` -> `#empezar` CTA. Every entry leads somewhere real;
 *   unsupported links are not rendered at all. The Ingresar menu keeps both
 *   login destinations in one shared popup, so no login anchor is duplicated
 *   here.
 *
 * - `public` mode: the same detached floating capsule on every public browsing
 *   route rendered through `PublicShell` (board, canonical detail, company
 *   careers), carrying the brand home, `Vacantes` -> `/vacantes`, `Empresas`
 *   -> the canonical prototype company, the shared Ingresar menu, the shared
 *   theme control, and `Publicar vacante` -> `/empresa/vacantes/nueva`. Desktop
 *   destinations collapse below md; the retained controls stay reachable at
 *   375px. No placeholder link survives.
 *
 * All modes share the same theme control. The component is a client boundary
 * because ThemeToggle is a client leaf; the static landing content remains
 * outside this client boundary.
 */
export function PeopleFlowNavbar({ mode = "candidate" }: { mode?: NavbarMode }) {
  if (mode === "marketing") {
    return <MarketingNavbar />;
  }
  if (mode === "public") {
    return <PublicNavbar />;
  }
  return <CandidateNavbar />;
}
