import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

import { SectionNavigator } from "./section-navigator";
import {
  VACANCY_FORM_SECTIONS,
  sectionAnchorId,
  sectionTitle,
} from "./section-metadata";
import type { VacancySectionId } from "./section-metadata";

const NAV_LABEL = "Secciones de la vacante";
const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";
// Pinned cross-file contract: the bar's observer inset equals the `scroll-mt-24`
// offset every FormSectionCard carries.
const ROOT_MARGIN = "-96px 0px -55% 0px";
const SOURCE = "src/features/jobs/create/form/section-navigator.tsx";

const observers: MockIntersectionObserver[] = [];

class MockIntersectionObserver {
  observed: Element[] = [];
  disconnected = false;
  constructor(
    readonly callback: IntersectionObserverCallback,
    readonly options?: IntersectionObserverInit,
  ) {
    observers.push(this);
  }
  observe(element: Element) { this.observed.push(element); }
  disconnect() { this.disconnected = true; this.observed = []; }
}

let scrollIntoView = vi.fn();

/** jsdom has neither matchMedia(false) semantics nor scrollIntoView. */
function stubBrowserApis(reducedMotion = false) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query === REDUCED_MOTION_QUERY ? reducedMotion : false,
  }));
  scrollIntoView = vi.fn();
  Element.prototype.scrollIntoView = scrollIntoView;
}

/** The six cards the navigator observes, as the form really renders them. */
function mountSectionCards() {
  for (const section of VACANCY_FORM_SECTIONS) {
    const card = document.createElement("section");
    card.id = sectionAnchorId(section.id);
    const heading = document.createElement("h2");
    heading.tabIndex = -1;
    heading.textContent = section.title;
    card.append(heading);
    document.body.append(card);
  }
}

const cardOf = (id: VacancySectionId) =>
  document.getElementById(sectionAnchorId(id)) as HTMLElement;
const linkTo = (id: VacancySectionId) =>
  screen.getByRole("link", { name: sectionTitle(id) });

function entryFor(target: Element, top: number, isIntersecting = true) {
  return {
    target,
    isIntersecting,
    boundingClientRect: { top } as DOMRect,
  } as IntersectionObserverEntry;
}

function intersect(entries: IntersectionObserverEntry[]) {
  const observer = observers.at(-1);
  if (observer === undefined) throw new Error("no observer was created");
  act(() => {
    observer.callback(entries, observer as unknown as IntersectionObserver);
  });
}

/** Whether each click that reached the document was cancelled, oldest first. */
let cancelled: boolean[] = [];
document.addEventListener("click", (event) => cancelled.push(event.defaultPrevented));

beforeEach(() => {
  observers.length = 0;
  cancelled = [];
  document.body.replaceChildren();
  window.history.replaceState(null, "", "/");
  stubBrowserApis();
  vi.stubGlobal("IntersectionObserver", MockIntersectionObserver);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe("SectionNavigator", () => {
  it("renders the canonical index in order and marks the first section beyond color alone", () => {
    expect(readFileSync(SOURCE, "utf8").startsWith('"use client";')).toBe(true);
    expect(SectionNavigator.length).toBe(0);
    mountSectionCards();
    render(<SectionNavigator />);

    const nav = screen.getByRole("navigation", { name: NAV_LABEL });
    const links = within(nav).getAllByRole("link");
    expect(links.map((item) => item.textContent)).toEqual(
      VACANCY_FORM_SECTIONS.map((section) => section.title),
    );
    expect(links.map((item) => item.getAttribute("href"))).toEqual(
      VACANCY_FORM_SECTIONS.map((section) => `#${sectionAnchorId(section.id)}`),
    );
    for (const item of links) expect(document.querySelector(item.getAttribute("href") as string)).not.toBeNull();
    // A landmark, not a competing heading structure.
    expect(within(nav).queryAllByRole("heading")).toHaveLength(0);
    // NVS-11 owns real sticky geometry, observer thresholds, smooth scrolling,
    // horizontal overflow, and focus visuals in a browser.
    for (const token of ["sticky", "top-0", "overflow-x-auto", "bg-background"]) expect(nav.className).toContain(token);
    expect(nav.className).not.toContain("bg-background/");

    // The deterministic first section is current: a leading bar plus weight,
    // never color alone.
    const active = linkTo("basic-information");
    expect(active).toHaveAttribute("aria-current", "location");
    expect(active.className).toContain("border-primary");
    expect(active.className).toContain("font-semibold");
    const inactive = linkTo("compensation");
    expect(inactive).not.toHaveAttribute("aria-current");
    expect(inactive.className).toContain("border-transparent");
    expect(inactive.className).toContain("font-normal");
  });

  it("watches the six existing cards, follows them, and disconnects on cleanup", () => {
    mountSectionCards();
    const { unmount } = render(<SectionNavigator />);

    expect(observers).toHaveLength(1);
    expect(observers[0].options?.rootMargin).toBe(ROOT_MARGIN);
    expect(observers[0].options?.threshold).toBe(0);
    expect(observers[0].observed.map((element) => element.id)).toEqual(
      VACANCY_FORM_SECTIONS.map((section) => sectionAnchorId(section.id)),
    );

    // The intersecting card nearest the viewport top becomes current; an entry
    // that left the adjusted root must not win.
    intersect([
      entryFor(cardOf("compensation"), 420),
      entryFor(cardOf("strategy"), 48),
    ]);
    expect(linkTo("strategy")).toHaveAttribute("aria-current", "location");

    // Later callbacks contain changed targets only; the stored nearer section wins.
    intersect([entryFor(cardOf("compensation"), 220)]);
    expect(linkTo("strategy")).toHaveAttribute("aria-current", "location");

    // Nothing intersecting any more: the marker stays where it was.
    intersect([
      entryFor(cardOf("strategy"), -320, false),
      entryFor(cardOf("compensation"), -400, false),
    ]);
    expect(linkTo("strategy")).toHaveAttribute("aria-current", "location");

    unmount();
    expect(observers[0].disconnected).toBe(true);
    expect(observers[0].observed).toEqual([]);
  });

  it("keeps the initial section when the browser has no IntersectionObserver", () => {
    vi.stubGlobal("IntersectionObserver", undefined);
    mountSectionCards();
    render(<SectionNavigator />);

    expect(observers).toHaveLength(0);
    expect(linkTo("basic-information")).toHaveAttribute("aria-current", "location");
  });

  it("takes over a plain primary click and honors reduced motion", () => {
    mountSectionCards();
    const focus = vi.spyOn(HTMLElement.prototype, "focus");
    render(<SectionNavigator />);

    const target = cardOf("benefits-pay-frequency");
    const heading = target.querySelector("h2") as HTMLElement;
    fireEvent.click(linkTo("benefits-pay-frequency"));

    expect(cancelled).toEqual([true]);
    expect(window.location.hash).toBe("");
    expect(linkTo("benefits-pay-frequency")).toHaveAttribute("aria-current", "location");
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView.mock.instances[0]).toBe(target);
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "start" });
    expect(focus).toHaveBeenCalledTimes(1);
    expect(focus.mock.instances[0]).toBe(heading);
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(heading).toHaveFocus();

    // The reduced-motion query is read per click, not cached at mount.
    stubBrowserApis(true);
    fireEvent.click(linkTo("compensation"));
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "auto", block: "start" });
  });

  it("leaves modified and non-primary clicks to the browser", () => {
    mountSectionCards();
    const focus = vi.spyOn(HTMLElement.prototype, "focus");
    render(<SectionNavigator />);

    const target = linkTo("strategy");
    const modifiedClicks = [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }];
    for (const init of modifiedClicks) fireEvent.click(target, init);

    expect(cancelled).toEqual([false, false, false, false, false]);
    expect(scrollIntoView).not.toHaveBeenCalled();
    expect(focus).not.toHaveBeenCalled();
    expect(target).not.toHaveAttribute("aria-current");
    expect(linkTo("basic-information")).toHaveAttribute("aria-current", "location");
  });
});
