import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, render } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

type ObserverInstance = {
  callback: IntersectionObserverCallback;
  observed: Element[];
  disconnected: boolean;
  trigger: (target: Element) => void;
};

const observerDouble = vi.hoisted(() => ({
  instances: [] as ObserverInstance[],
}));

class MockIntersectionObserver {
  readonly root = null;
  readonly rootMargin = "";
  readonly thresholds: ReadonlyArray<number> = [];
  observed: Element[] = [];
  disconnected = false;
  constructor(private readonly callback: IntersectionObserverCallback) {
    observerDouble.instances.push(this as unknown as ObserverInstance);
  }
  observe(el: Element) {
    this.observed.push(el);
  }
  unobserve(el: Element) {
    this.observed = this.observed.filter((item) => item !== el);
  }
  disconnect() {
    this.disconnected = true;
    this.observed = [];
  }
  takeRecords() {
    return [];
  }
  trigger(target: Element) {
    this.callback(
      [{ isIntersecting: true, target } as IntersectionObserverEntry],
      this as unknown as IntersectionObserver,
    );
  }
}

import { ReferenceLandingMotion } from "@/components/marketing/ReferenceLandingMotion";

function stubMatchMedia(reducedMotion: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches: reducedMotion,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
}

function mountFixture() {
  document.body.innerHTML = `
    <div data-pf-reference-landing class="pf-reference-landing">
      <header id="nav"></header>
      <div class="reveal" data-testid="reveal-1"></div>
      <div class="reveal" data-testid="reveal-2"></div>
    </div>
  `;
  return {
    root: document.querySelector<HTMLElement>("[data-pf-reference-landing]")!,
    nav: document.getElementById("nav")!,
  };
}

afterEach(() => {
  observerDouble.instances.length = 0;
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("ReferenceLandingMotion", () => {
  it("renders no DOM of its own", () => {
    stubMatchMedia(false);
    vi.stubGlobal("IntersectionObserver", MockIntersectionObserver);

    const { container } = render(<ReferenceLandingMotion />);

    expect(container).toBeEmptyDOMElement();
  });

  it("marks the root motion-ready and reveals elements on intersect", () => {
    stubMatchMedia(false);
    vi.stubGlobal("IntersectionObserver", MockIntersectionObserver);
    const { root } = mountFixture();

    render(<ReferenceLandingMotion />);

    expect(root.classList.contains("pf-motion-ready")).toBe(true);

    const observer = observerDouble.instances.at(-1)!;
    expect(observer.observed).toHaveLength(2);

    const first = root.querySelector("[data-testid='reveal-1']")!;
    act(() => {
      observer.trigger(first);
    });
    expect(first.classList.contains("in")).toBe(true);
  });

  it("keeps content visible under reduced motion without hiding it first", () => {
    stubMatchMedia(true);
    vi.stubGlobal("IntersectionObserver", MockIntersectionObserver);
    const { root } = mountFixture();

    render(<ReferenceLandingMotion />);

    expect(root.classList.contains("pf-motion-ready")).toBe(false);
    for (const el of root.querySelectorAll(".reveal")) {
      expect(el.classList.contains("in")).toBe(true);
    }
  });

  it("adds the scrolled backdrop to the nav after the scroll threshold", () => {
    stubMatchMedia(false);
    vi.stubGlobal("IntersectionObserver", MockIntersectionObserver);
    const { nav } = mountFixture();
    Object.defineProperty(window, "scrollY", {
      value: 0,
      writable: true,
      configurable: true,
    });

    render(<ReferenceLandingMotion />);

    expect(nav.classList.contains("scrolled")).toBe(false);
    act(() => {
      window.scrollY = 40;
      window.dispatchEvent(new Event("scroll"));
    });
    expect(nav.classList.contains("scrolled")).toBe(true);
    act(() => {
      window.scrollY = 0;
      window.dispatchEvent(new Event("scroll"));
    });
    expect(nav.classList.contains("scrolled")).toBe(false);
  });

  it("disconnects the observer and removes the scroll listener on unmount", () => {
    stubMatchMedia(false);
    vi.stubGlobal("IntersectionObserver", MockIntersectionObserver);
    mountFixture();
    const removeSpy = vi.spyOn(window, "removeEventListener");

    const { unmount } = render(<ReferenceLandingMotion />);
    const observer = observerDouble.instances.at(-1)!;
    unmount();

    expect(observer.disconnected).toBe(true);
    expect(removeSpy).toHaveBeenCalledWith("scroll", expect.any(Function));
  });
});
