"use client";

import * as React from "react";

import { cn } from "cn";

import { VACANCY_FORM_SECTIONS, sectionAnchorId } from "./section-metadata";
import type { VacancySectionId } from "./section-metadata";

/**
 * Observer inset of the sticky navigator: the bar is sticky at `top-0`, so the
 * root starts `96px` down — exactly the `scroll-mt-24` offset every
 * `FormSectionCard` carries — and stops 55% short of the bottom, so a tall card
 * cannot hold the marker while the section being read has already taken over.
 */
const STICKY_NAV_ROOT_MARGIN = "-96px 0px -55% 0px";
const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

/** Anchor of each canonical section, resolved back to its metadata id. */
const SECTION_BY_ANCHOR: ReadonlyMap<string, VacancySectionId> = new Map(
  VACANCY_FORM_SECTIONS.map(
    (section) => [sectionAnchorId(section.id), section.id] as const,
  ),
);

/**
 * Horizontal index of the six canonical sections of the create-vacancy form.
 *
 * Order, Spanish titles, and `#vacancy-section-*` targets come from
 * `VACANCY_FORM_SECTIONS` and `sectionAnchorId` alone, so they cannot drift from
 * the rendered cards. A plain primary click stays in-page: it cancels the hash
 * mutation, scrolls the matching card under the sticky bar, and focuses that
 * card's level-two heading. Every other click keeps its native behavior.
 */
export function SectionNavigator() {
  const [activeId, setActiveId] = React.useState<VacancySectionId>(
    VACANCY_FORM_SECTIONS[0].id,
  );

  React.useEffect(() => {
    // Older engines keep the deterministic first-section marker instead.
    if (typeof IntersectionObserver === "undefined") return;

    const observed = new Map<Element, IntersectionObserverEntry>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) observed.set(entry.target, entry);
        const visible = [...observed.values()].filter((entry) => entry.isIntersecting);
        if (visible.length === 0) return;
        // The edge nearest the viewport top wins: a card sliding away above the
        // bar must not beat the one entering below it.
        const nearest = visible.reduce((closest, entry) =>
          Math.abs(entry.boundingClientRect.top) <
          Math.abs(closest.boundingClientRect.top)
            ? entry
            : closest,
        );
        const next = SECTION_BY_ANCHOR.get(nearest.target.id);
        if (next !== undefined) setActiveId(next);
      },
      { rootMargin: STICKY_NAV_ROOT_MARGIN, threshold: 0 },
    );

    for (const anchor of SECTION_BY_ANCHOR.keys()) {
      const card = document.getElementById(anchor);
      if (card !== null) observer.observe(card);
    }
    return () => observer.disconnect();
  }, []);

  function handleSelect(event: React.MouseEvent<HTMLAnchorElement>, id: VacancySectionId) {
    // Modified and non-primary clicks keep their native link behavior.
    const modified =
      event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;
    if (modified) return;

    event.preventDefault();
    setActiveId(id);
    const card = document.getElementById(sectionAnchorId(id));
    if (card === null) return;

    const instant = window.matchMedia(REDUCED_MOTION_QUERY).matches;
    card.scrollIntoView({
      behavior: instant ? "auto" : "smooth",
      block: "start",
    });
    card.querySelector("h2")?.focus({ preventScroll: true });
  }

  return (
    <nav
      aria-label="Secciones de la vacante"
      data-pf-section-navigator=""
      className="sticky top-0 z-10 overflow-x-auto border-b border-border bg-background py-2"
    >
      <ul className="flex w-max min-w-full items-center gap-1">
        {VACANCY_FORM_SECTIONS.map((section) => (
          <li key={section.id} className="shrink-0">
            <a
              href={`#${sectionAnchorId(section.id)}`}
              aria-current={section.id === activeId ? "location" : undefined}
              onClick={(event) => handleSelect(event, section.id)}
              className={cn(
                "inline-flex items-center rounded-md border-l-2 py-1.5 pr-2.5 pl-2 text-sm whitespace-nowrap transition-colors",
                section.id === activeId
                  ? "border-primary font-semibold text-foreground"
                  : "border-transparent font-normal text-muted-foreground hover:text-foreground",
              )}
            >
              {section.title}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
