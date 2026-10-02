"use client";

import * as React from "react";
import { flushSync } from "react-dom";
import { Monitor, Moon, Sun } from "lucide-react";
import { cn } from "cn";

import { Button } from "@/components/ui/button";
import {
  applyThemeMode,
  readStoredThemeMode,
  resolveTheme,
  SYSTEM_DARK_QUERY,
  type ThemeMode,
} from "./theme-preferences";

/** Official Magic UI default reveal duration. */
const REVEAL_DURATION_MS = 400;

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

/** Transient scope: set on <html> only while a reveal is in flight. */
const REVEAL_ROOT_DATASET_KEY = "pfThemeVt";
const REVEAL_ROOT_ATTRIBUTE_VALUE = "active";
const REVEAL_DURATION_VARIABLE = "--pf-theme-vt-duration";
const REVEAL_CLIP_VARIABLE = "--pf-theme-vt-clip-from";

/**
 * Cross-instance ownership guard. Several pages mount more than one shared
 * ThemeToggle, so ownership — not mere mount state — decides who may tear down
 * the transient root scope: unmounting an inactive toggle can never clean up
 * another toggle's live reveal.
 */
let activeRevealOwner: string | null = null;

/**
 * Collapsed and expanded clip paths for the circular reveal, adapted from the
 * official Magic UI Animated Theme Toggler.
 *
 * All coordinates are percentages of the viewport: Chrome renders absolute px
 * clip-path coordinates on ::view-transition-new(root) unscaled on fractional
 * display scales (e.g. Windows 150%) for the first transition after load, so
 * px values land at the wrong position. A circle() percentage radius resolves
 * against hypot(width, height) / sqrt(2) of the snapshot reference box.
 */
function getCircleClipPaths(
  centerX: number,
  centerY: number,
  maxRadius: number,
  viewportWidth: number,
  viewportHeight: number,
): [from: string, to: string] {
  const toX = (x: number) => `${(x / viewportWidth) * 100}%`;
  const toY = (y: number) => `${(y / viewportHeight) * 100}%`;
  const center = `${toX(centerX)} ${toY(centerY)}`;
  const radius =
    (maxRadius / (Math.hypot(viewportWidth, viewportHeight) / Math.SQRT2)) *
    100;
  return [`circle(0% at ${center})`, `circle(${radius}% at ${center})`];
}

/**
 * Manual theme control with a circular reveal on activation.
 *
 * Every guarantee of the previous manual control is preserved: the persisted
 * `pf-theme` choice, the resolved `data-theme` attribute plus the Tailwind
 * `dark` class, a system default followed by binary light/dark clicks, live OS
 * following while still in system mode, three always-rendered icons that CSS
 * reveals (hydration-stable markup), and the 40px target with its Spanish
 * accessible name. The pre-paint bootstrap in the root layout still owns the
 * initial application; this control only handles user interaction.
 *
 * The reveal is the official Magic UI effect adapted to that contract: a
 * 400ms circular clip-path expansion from the center of the activated button
 * (pointer or keyboard), driven by the View Transitions API and scoped to a
 * transient `<html data-pf-theme-vt="active">` flag so unrelated view
 * transitions are untouched. It is progressive enhancement: without
 * `document.startViewTransition`, or when the user asked for reduced motion,
 * the theme change is applied immediately with no transient root state.
 */
export function ThemeToggle({ className }: { className?: string }) {
  const [mode, setMode] = React.useState<ThemeMode>("system");
  const buttonRef = React.useRef<HTMLButtonElement>(null);
  const animationRef = React.useRef<Animation | null>(null);
  // Stable per-instance identity for the cross-toggle ownership guard. It is
  // never rendered, so markup stays identical between server and client.
  const ownerId = React.useId();

  React.useEffect(() => {
    setMode(readStoredThemeMode(window.localStorage));
    const media = window.matchMedia(SYSTEM_DARK_QUERY);
    const syncSystemPreference = () => {
      if (readStoredThemeMode(window.localStorage) === "system") {
        applyThemeMode("system");
      }
    };
    media.addEventListener("change", syncSystemPreference);
    return () => media.removeEventListener("change", syncSystemPreference);
  }, []);

  const cancelOwnedAnimation = React.useCallback(() => {
    animationRef.current?.cancel();
    animationRef.current = null;
  }, []);

  /**
   * Clean up after success, rejection, or owner unmount — and only for the
   * reveal this instance owns, so an inactive toggle can never disturb another
   * toggle's transition.
   */
  const releaseReveal = React.useCallback(() => {
    cancelOwnedAnimation();
    if (activeRevealOwner !== ownerId) return;
    activeRevealOwner = null;
    const root = document.documentElement;
    delete root.dataset[REVEAL_ROOT_DATASET_KEY];
    root.style.removeProperty(REVEAL_DURATION_VARIABLE);
    root.style.removeProperty(REVEAL_CLIP_VARIABLE);
  }, [cancelOwnedAnimation, ownerId]);

  React.useEffect(() => {
    return () => {
      releaseReveal();
    };
  }, [releaseReveal]);

  const cycleThemeMode = () => {
    // System default first, then binary light/dark — unchanged semantics.
    const next: ThemeMode =
      mode === "system"
        ? resolveTheme(
            "system",
            window.matchMedia(SYSTEM_DARK_QUERY).matches,
          ) === "dark"
          ? "light"
          : "dark"
        : mode === "light"
          ? "dark"
          : "light";

    const applyTheme = () => {
      applyThemeMode(next);
      setMode(next);
    };

    const root = document.documentElement;

    // Ownership outranks every fallback: a reveal that is already in flight
    // (from this instance or any other mounted toggle) swallows the activation
    // before any branch can mutate the theme underneath it. This also covers a
    // motion-preference or API-capability change mid-reveal, which would
    // otherwise take a fallback path and stack a second change.
    if (
      activeRevealOwner !== null ||
      root.dataset[REVEAL_ROOT_DATASET_KEY] === REVEAL_ROOT_ATTRIBUTE_VALUE
    ) {
      return;
    }

    const button = buttonRef.current;
    const prefersReducedMotion = window.matchMedia(REDUCED_MOTION_QUERY).matches;

    // Progressive enhancement: unsupported browsers and reduced motion both
    // apply the change immediately, without creating transient root state.
    if (
      !button ||
      prefersReducedMotion ||
      typeof document.startViewTransition !== "function"
    ) {
      applyTheme();
      return;
    }

    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    if (viewportWidth <= 0 || viewportHeight <= 0) {
      // Percentage clip coordinates need a measurable viewport.
      applyTheme();
      return;
    }

    const { top, left, width, height } = button.getBoundingClientRect();
    const centerX = left + width / 2;
    const centerY = top + height / 2;
    const maxRadius = Math.hypot(
      Math.max(centerX, viewportWidth - centerX),
      Math.max(centerY, viewportHeight - centerY),
    );
    const clipPaths = getCircleClipPaths(
      centerX,
      centerY,
      maxRadius,
      viewportWidth,
      viewportHeight,
    );

    // Root scope first: duration and the collapsed clip come from
    // PeopleFlow-owned variables the scoped CSS consumes, so the reveal stays
    // in sync with the view-transition group and Firefox never paints the new
    // theme unclipped between the snapshot and the ready-driven animation.
    root.dataset[REVEAL_ROOT_DATASET_KEY] = REVEAL_ROOT_ATTRIBUTE_VALUE;
    root.style.setProperty(REVEAL_DURATION_VARIABLE, `${REVEAL_DURATION_MS}ms`);
    root.style.setProperty(REVEAL_CLIP_VARIABLE, clipPaths[0]);
    activeRevealOwner = ownerId;

    let transition: ViewTransition;
    try {
      transition = document.startViewTransition(() => {
        // The theme must land synchronously inside the callback so the browser
        // snapshots it as the incoming root state.
        flushSync(applyTheme);
      });
    } catch {
      // Contain a synchronous failure: drop the transient scope and still
      // deliver the theme change the user asked for.
      releaseReveal();
      applyTheme();
      return;
    }

    const finished = transition.finished;
    if (finished && typeof finished.finally === "function") {
      // Success and rejection share one cleanup, and the rejection stays
      // contained instead of surfacing as an unhandled promise rejection.
      finished.finally(releaseReveal).catch(() => {});
    } else {
      releaseReveal();
    }

    const ready = transition.ready;
    if (ready && typeof ready.then === "function") {
      ready
        .then(() => {
          // A release (unmount, rejection, or a newer owner) leaves nothing to
          // animate.
          if (activeRevealOwner !== ownerId) return;
          animationRef.current = root.animate(
            { clipPath: clipPaths },
            {
              duration: REVEAL_DURATION_MS,
              easing: "ease-in-out",
              fill: "forwards",
              pseudoElement: "::view-transition-new(root)",
            },
          );
        })
        .catch(() => {
          // A rejected ready has no phase to animate: clean this instance's
          // work and keep the rejection contained.
          releaseReveal();
        });
    }
  };

  return (
    <Button
      ref={buttonRef}
      type="button"
      variant="outline"
      size="icon"
      aria-label="Cambiar tema"
      data-pf-theme-toggle=""
      onClick={cycleThemeMode}
      className={cn("size-10", className)}
    >
      <Sun aria-hidden="true" className="pf-icon-sun" />
      <Moon aria-hidden="true" className="pf-icon-moon" />
      <Monitor aria-hidden="true" className="pf-icon-system" />
    </Button>
  );
}
