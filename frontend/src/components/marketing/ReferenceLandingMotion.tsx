"use client";

import * as React from "react";

/**
 * Landing motion island — the two runtime behaviors the reference drives from
 * inline scripts at the end of <body>:
 *
 * 1. Reveal on scroll: an IntersectionObserver (threshold 0.14) that adds
 *    `.in` to each `.reveal` element, with a `(i % 4) * 80ms` stagger delay,
 *    exactly like the reference.
 * 2. Nav backdrop on scroll: toggles `.scrolled` on `#nav` once `scrollY > 12`.
 *
 * The hidden state is applied by CSS only after this island adds
 * `pf-motion-ready` to the `.pf-reference-landing` root, so server-rendered
 * content stays visible if JavaScript never runs. Reduced-motion users skip
 * the observer entirely and the content is marked visible immediately.
 *
 * The component renders nothing; it only wires behavior to the surrounding
 * page markup.
 */
export function ReferenceLandingMotion() {
  React.useEffect(() => {
    const root = document.querySelector<HTMLElement>(
      "[data-pf-reference-landing]",
    );
    if (!root) return;

    const prefersReducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;

    let observer: IntersectionObserver | undefined;
    const reveals = Array.from(root.querySelectorAll<HTMLElement>(".reveal"));

    if (prefersReducedMotion) {
      // Never hide content for a reduced-motion user: mark everything visible
      // and skip the observer + stagger entirely.
      reveals.forEach((el) => el.classList.add("in"));
    } else {
      root.classList.add("pf-motion-ready");
      observer = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting) {
              (entry.target as HTMLElement).classList.add("in");
              observer?.unobserve(entry.target);
            }
          });
        },
        { threshold: 0.14 },
      );
      reveals.forEach((el, index) => {
        el.style.transitionDelay = `${(index % 4) * 80}ms`;
        observer?.observe(el);
      });
    }

    const nav = root.querySelector<HTMLElement>("#nav");
    const onScroll = () => {
      nav?.classList.toggle("scrolled", window.scrollY > 12);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });

    return () => {
      observer?.disconnect();
      window.removeEventListener("scroll", onScroll);
    };
  }, []);

  return null;
}
