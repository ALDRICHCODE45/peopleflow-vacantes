import * as React from "react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";

import { ThemeToggle } from "./theme-toggle";

const DARK_QUERY = "(prefers-color-scheme: dark)";
const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

// Read from the project root: the jsdom environment rewrites import.meta.url
// to the page URL, so it cannot locate the stylesheet.
const globalsCss = readFileSync(
  resolve(process.cwd(), "src/app/globals.css"),
  "utf8",
);

type ChangeListener = (event: { matches: boolean }) => void;

type MediaQueryStub = {
  readonly matches: boolean;
  addEventListener: ReturnType<typeof vi.fn>;
  removeEventListener: ReturnType<typeof vi.fn>;
};

/**
 * Per-query matchMedia double: the theme control asks about the OS colour
 * scheme and about reduced motion, so the two must be answerable
 * independently.
 */
function stubMatchMedia(
  dark: boolean,
  options: { reducedMotion?: boolean } = {},
) {
  const state = { dark, reducedMotion: options.reducedMotion ?? false };
  const entries = new Map<
    string,
    { listeners: Set<ChangeListener>; media: MediaQueryStub }
  >();

  const matchesFor = (query: string) =>
    query === REDUCED_MOTION_QUERY ? state.reducedMotion : state.dark;

  const mediaFor = (query: string): MediaQueryStub => {
    const existing = entries.get(query);
    if (existing) return existing.media;

    const listeners = new Set<ChangeListener>();
    const media: MediaQueryStub = {
      get matches() {
        return matchesFor(query);
      },
      addEventListener: vi.fn((_type: string, listener: ChangeListener) => {
        listeners.add(listener);
      }),
      removeEventListener: vi.fn((_type: string, listener: ChangeListener) => {
        listeners.delete(listener);
      }),
    };
    entries.set(query, { listeners, media });
    return media;
  };

  const notify = (query: string) => {
    const entry = entries.get(query);
    if (!entry) return;
    for (const listener of entry.listeners) {
      listener({ matches: matchesFor(query) });
    }
  };

  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => mediaFor(query)),
  );

  return {
    media: mediaFor(DARK_QUERY),
    emit(next: boolean) {
      state.dark = next;
      notify(DARK_QUERY);
    },
    emitReducedMotion(next: boolean) {
      state.reducedMotion = next;
      notify(REDUCED_MOTION_QUERY);
    },
  };
}

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/**
 * Minimal View Transitions API double. `runCallback` plays the role of the
 * browser invoking the update callback; `ready` and `finished` are settled by
 * each test so the timing, animation, and cleanup paths are all observable.
 */
function stubViewTransition() {
  const ready = deferred();
  const finished = deferred();
  const callbacks: Array<() => void> = [];
  const startViewTransition = vi.fn((callback: () => void) => {
    callbacks.push(callback);
    return { ready: ready.promise, finished: finished.promise };
  });
  Reflect.set(document, "startViewTransition", startViewTransition);

  return {
    startViewTransition,
    runCallback() {
      const callback = callbacks.shift();
      if (!callback) {
        throw new Error("startViewTransition was never called");
      }
      callback();
    },
    resolveReady: () => ready.resolve(),
    rejectReady: (reason: unknown = new Error("ready rejected")) =>
      ready.reject(reason),
    resolveFinished: () => finished.resolve(),
    rejectFinished: (reason: unknown = new Error("finished rejected")) =>
      finished.reject(reason),
  };
}

/** Web Animations double: jsdom implements no animation engine. */
function stubAnimate() {
  type AnimationStub = {
    cancel: ReturnType<typeof vi.fn>;
    finished: Promise<void>;
  };
  const animations: AnimationStub[] = [];
  // The signature is declared on the mock so recorded calls stay typed.
  const animate = vi.fn<
    (keyframes: unknown, options?: unknown) => AnimationStub
  >(() => {
    const animation: AnimationStub = {
      cancel: vi.fn(),
      finished: Promise.resolve(),
    };
    animations.push(animation);
    return animation;
  });
  Reflect.set(Element.prototype, "animate", animate);
  return { animate, animations };
}

const originalViewport = {
  width: window.innerWidth,
  height: window.innerHeight,
};

function setViewport(width: number, height: number) {
  Reflect.set(window, "innerWidth", width);
  Reflect.set(window, "innerHeight", height);
}

function stubRect(
  element: Element,
  rect: { left: number; top: number; width: number; height: number },
) {
  element.getBoundingClientRect = () => ({
    ...rect,
    right: rect.left + rect.width,
    bottom: rect.top + rect.height,
    x: rect.left,
    y: rect.top,
    toJSON: () => ({}),
  });
}

/** Lets every pending microtask (promise reactions) run. */
const flushMicrotasks = () =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });

type RevealOptions = {
  dark?: boolean;
  reducedMotion?: boolean;
  rect?: { left: number; top: number; width: number; height: number };
  viewport?: { width: number; height: number };
};

const BUTTON_RECT = { left: 300, top: 100, width: 40, height: 40 };
const BUTTON_CENTER_CLIP = "circle(0% at 32% 30%)";
const OTHER_BUTTON_RECT = { left: 700, top: 20, width: 40, height: 40 };
const OTHER_BUTTON_CENTER_CLIP = "circle(0% at 72% 10%)";

/** Renders the toggle and activates it with a supported, motion-allowed click. */
async function activateReveal(options: RevealOptions = {}) {
  const user = userEvent.setup();
  // Every browser API is doubled before the first render: the control reads
  // matchMedia while mounting.
  const vt = stubViewTransition();
  const animation = stubAnimate();
  setViewport(options.viewport?.width ?? 1000, options.viewport?.height ?? 400);
  const matchMediaStub = stubMatchMedia(options.dark ?? false, {
    reducedMotion: options.reducedMotion,
  });
  const view = render(<ThemeToggle />);
  const button = screen.getByRole("button", { name: /cambiar tema/i });
  stubRect(button, options.rect ?? BUTTON_RECT);
  await user.click(button);
  return { ...vt, ...animation, ...matchMediaStub, view, button, user };
}

/**
 * Runs `body` while watching for unhandled rejections, so a swallowed
 * `ready`/`finished` rejection is provable instead of merely absent from the
 * assertion output.
 */
async function collectUnhandledRejections(body: () => Promise<void>) {
  const unhandled: unknown[] = [];
  const listener = (reason: unknown) => {
    unhandled.push(reason);
  };
  process.on("unhandledRejection", listener);
  try {
    await body();
    await flushMicrotasks();
    await flushMicrotasks();
  } finally {
    process.off("unhandledRejection", listener);
  }
  return unhandled;
}

afterEach(() => {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(document, "startViewTransition");
  Reflect.deleteProperty(Element.prototype, "animate");
  setViewport(originalViewport.width, originalViewport.height);
  localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.classList.remove("dark");
  delete document.documentElement.dataset.pfThemeVt;
  document.documentElement.style.removeProperty("--pf-theme-vt-duration");
  document.documentElement.style.removeProperty("--pf-theme-vt-clip-from");
});

describe("ThemeToggle", () => {
  it("renders a keyboard-focusable control with an accessible name", () => {
    stubMatchMedia(true);
    render(<ThemeToggle />);

    const button = screen.getByRole("button", { name: /cambiar tema/i });
    expect(button).toHaveAttribute("data-pf-theme-toggle");
  });

  it("defaults to the shared 40x40 hit target", () => {
    stubMatchMedia(true);
    render(<ThemeToggle />);

    const button = screen.getByRole("button", { name: /cambiar tema/i });
    expect(button.className).toContain("size-10");
    // The shared Button icon default (size-8) must not survive the override.
    expect(button.className).not.toContain("size-8");
  });

  it("lets an explicit caller size override the 40px default", () => {
    stubMatchMedia(true);
    render(<ThemeToggle className="size-11" />);

    const button = screen.getByRole("button", { name: /cambiar tema/i });
    expect(button.className).toContain("size-11");
    expect(button.className).not.toContain("size-10");
  });

  it("renders the CSS-driven icon contract for both themes and system", () => {
    stubMatchMedia(true);
    const { container } = render(<ThemeToggle />);

    // All three icons are always in the DOM; globals.css decides visibility
    // from the resolved theme, so markup never depends on browser state.
    expect(container.querySelector("svg.pf-icon-sun")).not.toBeNull();
    expect(container.querySelector("svg.pf-icon-moon")).not.toBeNull();
    expect(container.querySelector("svg.pf-icon-system")).not.toBeNull();
  });

  it("renders identical markup regardless of stored or system state", () => {
    // Server render cannot know browser state; the first client render must
    // not either, or hydration mismatches. A stored dark choice plus a dark
    // OS preference must produce the same markup as an empty store.
    stubMatchMedia(true);
    localStorage.setItem("pf-theme", "dark");
    const stored = render(<ThemeToggle />);
    const storedMarkup = stored.container.innerHTML;
    stored.unmount();

    localStorage.clear();
    const fresh = render(<ThemeToggle />);
    expect(fresh.container.innerHTML).toBe(storedMarkup);
  });

  it("applies and persists the opposite of the resolved system theme on first click", async () => {
    const user = userEvent.setup();
    stubMatchMedia(true); // OS prefers dark
    document.documentElement.classList.add("dark");
    render(<ThemeToggle />);

    await user.click(screen.getByRole("button", { name: /cambiar tema/i }));

    expect(localStorage.getItem("pf-theme")).toBe("light");
    expect(document.documentElement).not.toHaveClass("dark");
    expect(document.documentElement).toHaveAttribute("data-theme", "light");
  });

  it("persists light and removes dark class when toggling from dark effective on dark OS", async () => {
    const user = userEvent.setup();
    stubMatchMedia(true); // OS prefers dark
    document.documentElement.classList.add("dark");
    document.documentElement.setAttribute("data-theme", "dark");
    localStorage.setItem("pf-theme", "dark"); // Manual dark preference
    render(<ThemeToggle />);

    await user.click(screen.getByRole("button", { name: /cambiar tema/i }));

    // Binary toggle: dark → light, NO system intermediate
    expect(localStorage.getItem("pf-theme")).toBe("light");
    expect(document.documentElement).not.toHaveClass("dark");
    expect(document.documentElement).toHaveAttribute("data-theme", "light");
  });

  it("alternates light and dark across repeated clicks (binary toggle)", async () => {
    const user = userEvent.setup();
    stubMatchMedia(false); // OS prefers light; first click goes to dark
    render(<ThemeToggle />);

    // First click: system → dark
    await user.click(screen.getByRole("button", { name: /cambiar tema/i }));
    expect(localStorage.getItem("pf-theme")).toBe("dark");
    expect(document.documentElement).toHaveClass("dark");

    // Second click: dark → light
    await user.click(screen.getByRole("button", { name: /cambiar tema/i }));
    expect(localStorage.getItem("pf-theme")).toBe("light");
    expect(document.documentElement).not.toHaveClass("dark");
    expect(document.documentElement).toHaveAttribute("data-theme", "light");

    // Third click: light → dark
    await user.click(screen.getByRole("button", { name: /cambiar tema/i }));
    expect(localStorage.getItem("pf-theme")).toBe("dark");
    expect(document.documentElement).toHaveClass("dark");

    // Fourth click: dark → light (cycle continues)
    await user.click(screen.getByRole("button", { name: /cambiar tema/i }));
    expect(localStorage.getItem("pf-theme")).toBe("light");
    expect(document.documentElement).not.toHaveClass("dark");
  });

  it("follows live OS preference changes while in system mode", () => {
    const stub = stubMatchMedia(false);
    // System mode holds no explicit choice; the control must keep the
    // document in sync when the OS preference flips, without persisting it.
    localStorage.removeItem("pf-theme");
    render(<ThemeToggle />);

    stub.emit(true);
    expect(document.documentElement).toHaveClass("dark");
    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
    expect(localStorage.getItem("pf-theme")).toBeNull();

    stub.emit(false);
    expect(document.documentElement).not.toHaveClass("dark");
    expect(document.documentElement).toHaveAttribute("data-theme", "light");
  });
});

describe("ThemeToggle animated reveal", () => {
  it("applies the theme immediately without transient root state when the View Transitions API is missing", async () => {
    const user = userEvent.setup();
    stubMatchMedia(false);
    render(<ThemeToggle />);

    await user.click(screen.getByRole("button", { name: /cambiar tema/i }));

    // Unchanged semantics, and no reveal scope was ever created.
    expect(localStorage.getItem("pf-theme")).toBe("dark");
    expect(document.documentElement).toHaveClass("dark");
    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
    expect(document.documentElement.dataset.pfThemeVt).toBeUndefined();
    expect(
      document.documentElement.style.getPropertyValue("--pf-theme-vt-duration"),
    ).toBe("");
    expect(
      document.documentElement.style.getPropertyValue("--pf-theme-vt-clip-from"),
    ).toBe("");
  });

  it("applies the theme immediately and starts no transition when motion is reduced", async () => {
    const user = userEvent.setup();
    const vt = stubViewTransition();
    const { animate } = stubAnimate();
    stubMatchMedia(false, { reducedMotion: true });
    render(<ThemeToggle />);

    await user.click(screen.getByRole("button", { name: /cambiar tema/i }));

    expect(vt.startViewTransition).not.toHaveBeenCalled();
    expect(animate).not.toHaveBeenCalled();
    expect(localStorage.getItem("pf-theme")).toBe("dark");
    expect(document.documentElement).toHaveClass("dark");
    expect(document.documentElement.dataset.pfThemeVt).toBeUndefined();
    expect(
      document.documentElement.style.getPropertyValue("--pf-theme-vt-duration"),
    ).toBe("");
  });

  it("defers the theme change to the view-transition callback and scopes it before starting", async () => {
    const reveal = await activateReveal();

    // The scope and its variables exist before the transition starts, so the
    // scoped CSS is in place when the snapshots are taken.
    expect(reveal.startViewTransition).toHaveBeenCalledTimes(1);
    expect(typeof reveal.startViewTransition.mock.calls[0][0]).toBe("function");
    expect(document.documentElement.dataset.pfThemeVt).toBe("active");
    expect(
      document.documentElement.style.getPropertyValue("--pf-theme-vt-duration"),
    ).toBe("400ms");
    expect(
      document.documentElement.style.getPropertyValue("--pf-theme-vt-clip-from"),
    ).toBe(BUTTON_CENTER_CLIP);

    // Nothing is applied yet: the callback owns the synchronous update.
    expect(document.documentElement).not.toHaveClass("dark");
    expect(localStorage.getItem("pf-theme")).toBeNull();

    act(() => {
      reveal.runCallback();
    });

    expect(document.documentElement).toHaveClass("dark");
    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
    expect(localStorage.getItem("pf-theme")).toBe("dark");
  });

  it("animates the new root pseudo-element with percentage circle keyframes", async () => {
    const reveal = await activateReveal();

    reveal.resolveReady();
    await flushMicrotasks();

    expect(reveal.animate).toHaveBeenCalledTimes(1);
    const [keyframes, options] = reveal.animate.mock.calls[0];
    expect(options).toEqual({
      duration: 400,
      easing: "ease-in-out",
      fill: "forwards",
      pseudoElement: "::view-transition-new(root)",
    });

    const clipPaths = (keyframes as { clipPath: [string, string] }).clipPath;
    expect(clipPaths[0]).toBe(BUTTON_CENTER_CLIP);
    // maxRadius = hypot(max(320, 680), max(120, 280)); a circle() percentage
    // radius resolves against hypot(1000, 400) / sqrt(2).
    expect(clipPaths[1]).toMatch(/^circle\([\d.]+% at 32% 30%\)$/);
    expect(clipPaths[1]).not.toContain("px");
    const radiusPercent = Number(
      /^circle\(([\d.]+)% at 32% 30%\)$/.exec(clipPaths[1])?.[1],
    );
    expect(radiusPercent).toBeCloseTo(96.5616, 3);
  });

  it("reveals from the activated button center for keyboard activation", async () => {
    const user = userEvent.setup();
    const vt = stubViewTransition();
    stubAnimate();
    setViewport(1000, 400);
    stubMatchMedia(false);
    const view = render(<ThemeToggle />);
    const button = screen.getByRole("button", { name: /cambiar tema/i });
    stubRect(button, OTHER_BUTTON_RECT);
    button.focus();
    await user.keyboard("{Enter}");

    expect(button).toHaveFocus();
    expect(vt.startViewTransition).toHaveBeenCalledTimes(1);
    expect(
      document.documentElement.style.getPropertyValue("--pf-theme-vt-clip-from"),
    ).toBe(OTHER_BUTTON_CENTER_CLIP);
    act(() => {
      vt.runCallback();
    });
    expect(document.documentElement).toHaveClass("dark");
    view.unmount();
  });

  it("cleans the owned scope, variables, and animation after the transition resolves", async () => {
    const reveal = await activateReveal();
    act(() => {
      reveal.runCallback();
    });
    reveal.resolveReady();
    await flushMicrotasks();
    expect(reveal.animations).toHaveLength(1);

    reveal.resolveFinished();
    await flushMicrotasks();

    expect(document.documentElement.dataset.pfThemeVt).toBeUndefined();
    expect(
      document.documentElement.style.getPropertyValue("--pf-theme-vt-duration"),
    ).toBe("");
    expect(
      document.documentElement.style.getPropertyValue("--pf-theme-vt-clip-from"),
    ).toBe("");
    expect(reveal.animations[0].cancel).toHaveBeenCalledTimes(1);
    // The theme change itself survives the cleanup.
    expect(document.documentElement).toHaveClass("dark");
    expect(localStorage.getItem("pf-theme")).toBe("dark");
  });

  it("cleans up and contains the rejection when the transition is not ready", async () => {
    const reveal = await activateReveal();
    reveal.resolveFinished();

    const unhandled = await collectUnhandledRejections(async () => {
      reveal.rejectReady(new Error("ready rejected"));
      await flushMicrotasks();
    });

    expect(unhandled).toEqual([]);
    expect(document.documentElement.dataset.pfThemeVt).toBeUndefined();
    expect(
      document.documentElement.style.getPropertyValue("--pf-theme-vt-duration"),
    ).toBe("");
    expect(
      document.documentElement.style.getPropertyValue("--pf-theme-vt-clip-from"),
    ).toBe("");
  });

  it("cleans up and contains the rejection when the transition fails", async () => {
    const reveal = await activateReveal();
    reveal.resolveReady();
    await flushMicrotasks();

    const unhandled = await collectUnhandledRejections(async () => {
      reveal.rejectFinished(new Error("finished rejected"));
      await flushMicrotasks();
    });

    expect(unhandled).toEqual([]);
    expect(document.documentElement.dataset.pfThemeVt).toBeUndefined();
    expect(
      document.documentElement.style.getPropertyValue("--pf-theme-vt-duration"),
    ).toBe("");
    expect(reveal.animations[0].cancel).toHaveBeenCalledTimes(1);
  });

  it("cleans the owned scope and animation when the owner unmounts mid-reveal", async () => {
    const reveal = await activateReveal();
    reveal.resolveReady();
    await flushMicrotasks();
    expect(reveal.animations).toHaveLength(1);

    reveal.view.unmount();

    expect(document.documentElement.dataset.pfThemeVt).toBeUndefined();
    expect(
      document.documentElement.style.getPropertyValue("--pf-theme-vt-duration"),
    ).toBe("");
    expect(
      document.documentElement.style.getPropertyValue("--pf-theme-vt-clip-from"),
    ).toBe("");
    expect(reveal.animations[0].cancel).toHaveBeenCalledTimes(1);
  });

  it("keeps another toggle's live reveal when an inactive toggle unmounts", async () => {
    const user = userEvent.setup();
    const vt = stubViewTransition();
    const { animate, animations } = stubAnimate();
    setViewport(1000, 400);
    stubMatchMedia(false);

    const bystander = render(<ThemeToggle />);
    const owner = render(<ThemeToggle />);
    const [bystanderButton, ownerButton] = screen.getAllByRole("button", {
      name: /cambiar tema/i,
    });
    stubRect(bystanderButton, BUTTON_RECT);
    stubRect(ownerButton, OTHER_BUTTON_RECT);

    // The activated toggle owns the reveal and supplies its own center.
    await user.click(ownerButton);
    expect(
      document.documentElement.style.getPropertyValue("--pf-theme-vt-clip-from"),
    ).toBe(OTHER_BUTTON_CENTER_CLIP);

    // The inactive toggle leaves the page while the reveal is in flight.
    bystander.unmount();

    expect(document.documentElement.dataset.pfThemeVt).toBe("active");
    expect(
      document.documentElement.style.getPropertyValue("--pf-theme-vt-duration"),
    ).toBe("400ms");
    expect(
      document.documentElement.style.getPropertyValue("--pf-theme-vt-clip-from"),
    ).toBe(OTHER_BUTTON_CENTER_CLIP);

    // The owner still finishes its own animation and cleanup.
    vt.resolveReady();
    await flushMicrotasks();
    expect(animate).toHaveBeenCalledTimes(1);
    vt.resolveFinished();
    await flushMicrotasks();
    expect(animations[0].cancel).toHaveBeenCalledTimes(1);
    expect(document.documentElement.dataset.pfThemeVt).toBeUndefined();

    owner.unmount();
  });

  it("blocks overlapping reveals from rapid clicks and from another mounted toggle", async () => {
    const user = userEvent.setup();
    const vt = stubViewTransition();
    stubAnimate();
    setViewport(1000, 400);
    stubMatchMedia(false);

    render(<ThemeToggle />);
    render(<ThemeToggle />);
    const [first, second] = screen.getAllByRole("button", {
      name: /cambiar tema/i,
    });
    stubRect(first, BUTTON_RECT);
    stubRect(second, OTHER_BUTTON_RECT);

    await user.click(first);
    await user.click(first); // rapid re-activation of the same toggle
    await user.click(second); // cross-toggle activation while in flight

    expect(vt.startViewTransition).toHaveBeenCalledTimes(1);
    // The swallowed activations changed nothing.
    expect(localStorage.getItem("pf-theme")).toBeNull();
    expect(document.documentElement).not.toHaveClass("dark");

    act(() => {
      vt.runCallback();
    });
    expect(localStorage.getItem("pf-theme")).toBe("dark");

    vt.resolveFinished();
    await flushMicrotasks();
    expect(document.documentElement.dataset.pfThemeVt).toBeUndefined();

    // Once the reveal is released, the next activation is allowed again.
    await user.click(second);
    expect(vt.startViewTransition).toHaveBeenCalledTimes(2);
  });

  it("swallows a re-activation while a reveal is in flight even when motion is reduced mid-reveal", async () => {
    const reveal = await activateReveal();
    const root = document.documentElement;
    expect(reveal.startViewTransition).toHaveBeenCalledTimes(1);
    expect(root.dataset.pfThemeVt).toBe("active");

    // The motion budget flips while the first reveal is still pending, so the
    // fallback branch would otherwise apply a second theme change underneath
    // the reveal that still owns the root scope.
    reveal.emitReducedMotion(true);
    await reveal.user.click(reveal.button);

    expect(reveal.startViewTransition).toHaveBeenCalledTimes(1);
    expect(root.dataset.pfThemeVt).toBe("active");
    expect(localStorage.getItem("pf-theme")).toBeNull();
    expect(root).not.toHaveClass("dark");

    // The owner still applies its own change and cleans up normally.
    act(() => {
      reveal.runCallback();
    });
    expect(localStorage.getItem("pf-theme")).toBe("dark");
    reveal.resolveFinished();
    await flushMicrotasks();
    expect(root.dataset.pfThemeVt).toBeUndefined();
  });

  it("swallows activation from another toggle when the View Transitions API disappears mid-reveal", async () => {
    const reveal = await activateReveal();
    const root = document.documentElement;
    expect(root.dataset.pfThemeVt).toBe("active");

    const user = userEvent.setup();
    const other = render(<ThemeToggle />);
    const otherButton = screen.getAllByRole("button", {
      name: /cambiar tema/i,
    })[1];

    // The API goes away while the first reveal is still pending.
    Reflect.deleteProperty(document, "startViewTransition");
    await user.click(otherButton);

    expect(root.dataset.pfThemeVt).toBe("active");
    expect(localStorage.getItem("pf-theme")).toBeNull();
    expect(root).not.toHaveClass("dark");

    // The owner's reveal still completes and cleans up normally.
    act(() => {
      reveal.runCallback();
    });
    reveal.resolveFinished();
    await flushMicrotasks();
    expect(root.dataset.pfThemeVt).toBeUndefined();
    other.unmount();
  });
});

describe("ThemeToggle View Transition CSS contract", () => {
  it("scopes every view-transition pseudo-element rule behind the transient scope", () => {
    // A global ::view-transition-* rule would also restyle navigation and any
    // other view transition in the app, so each selector that targets one must
    // carry the transient scope prefix.
    // Comments are stripped first so prose about the API cannot be mistaken
    // for a selector.
    const cssRules = globalsCss.replace(/\/\*[\s\S]*?\*\//g, "");
    const selectors = [...cssRules.matchAll(/([^{}]+)\{/g)]
      .flatMap(([, prelude]) => prelude.split(","))
      .map((selector) => selector.trim())
      .filter((selector) => selector.includes("::view-transition"));

    expect(selectors.length).toBeGreaterThan(0);
    for (const selector of selectors) {
      expect(selector.startsWith('html[data-pf-theme-vt="active"]')).toBe(true);
    }
  });

  it("drives the reveal from PeopleFlow-owned duration and clip properties", () => {
    expect(globalsCss).toContain(
      'html[data-pf-theme-vt="active"]::view-transition-group(root)',
    );
    expect(globalsCss).toContain(
      'html[data-pf-theme-vt="active"]::view-transition-new(root)',
    );
    expect(globalsCss).toContain(
      "animation-duration: var(--pf-theme-vt-duration)",
    );
    expect(globalsCss).toContain("clip-path: var(--pf-theme-vt-clip-from)");
  });
});
