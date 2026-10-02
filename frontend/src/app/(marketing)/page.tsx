import "@/components/marketing/reference-landing.css";

import {
  EmployerFooter,
  EmployerLanding,
} from "@/components/marketing/EmployerLanding";
import { ReferenceLandingMotion } from "@/components/marketing/ReferenceLandingMotion";
import { PeopleFlowNavbar } from "@/components/navigation/PeopleFlowNavbar";

/**
 * Root marketing page — faithful replica of design/landing-preview.
 *
 * Server component: no fetch, no client boundary at the page level. The page
 * composes the reference order exactly (nav → hero/pipeline/stats → two
 * systems → bento value props → kanban showcase → closing CTA → footer) inside
 * the scoped `.pf-reference-landing` root, which owns the marketing-only
 * stylesheet so nothing leaks into candidate/auth routes.
 *
 * The only client boundaries are the navbar's ThemeToggle, the HeroAurora
 * WebGL canvas, and the ReferenceLandingMotion reveal/nav-scroll island.
 *
 * Layout contract (RL-02 correction):
 * - `overflow-x-clip` (never the scroll-container overflow utility) keeps
 *   horizontal containment without creating a scroll container, so the sticky
 *   `#nav` stays pinned to the viewport in every context.
 * - `isolate` gives the root its own stacking context so the opaque `bg-base`
 *   background and the negative-z fixed ambient layers (`bg-grid`, `top-glow`)
 *   paint in the reference order: background, then ambient, then content.
 */
export default function MarketingPage() {
  return (
    <div
      data-pf-reference-landing=""
      className="pf-reference-landing isolate min-h-screen overflow-x-clip bg-base font-sans text-ink antialiased"
    >
      {/* ambient background layers */}
      <div className="bg-grid pointer-events-none fixed inset-0 -z-10" />
      <div className="top-glow pointer-events-none fixed inset-x-0 top-0 -z-10 h-[680px]" />

      <PeopleFlowNavbar mode="marketing" />

      <main>
        <EmployerLanding />
      </main>

      <EmployerFooter />
      <ReferenceLandingMotion />
    </div>
  );
}
