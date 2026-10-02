import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { FLOATING_LINES_CONFIG, FLOATING_LINES_MEDIA_QUERIES, FLOATING_LINES_OGL_FRAGMENT_SHADER, FLOATING_LINES_OGL_VERTEX_SHADER, FLOATING_LINES_REDUCED_MOTION_FRAME_TIME, FLOATING_LINES_VARIANTS } from "./floating-lines-shaders";
import { FloatingLines } from "./FloatingLines";

// Compact CCP-R7D2B lifecycle contract over an in-memory ogl stand-in (jsdom
// has no WebGL); deep palette/failure/browser proof belongs to CCP-R7D2C.

type Gl = { canvas: HTMLCanvasElement; getExtension: () => { loseContext(): void } | null; drawingBufferWidth: number; drawingBufferHeight: number };
type Rend = { gl: Gl | null; options: Record<string, unknown>; dpr: number };
type Prog = { uniforms: Record<string, { value: unknown }>; vertex: string; fragment: string };

const s = vi.hoisted(() => ({ rends: [] as Rend[], progs: [] as Prog[], renders: 0, raf: [] as Array<() => void>, cancelled: 0, lost: 0, disconnected: 0, added: [] as string[], snapshots: [] as number[][][], failSize: false }));
const media = { desktop: true, reduced: false };

vi.mock("ogl", () => {
  const mkGl = () => ({ canvas: document.createElement("canvas"), clearColor: () => { /* noop */ }, getExtension: () => ({ loseContext: () => { s.lost += 1; } }), drawingBufferWidth: 0, drawingBufferHeight: 0 });
  class Renderer {
    gl = mkGl();
    options: Record<string, unknown> = {};
    dpr = 1;
    setSize = (w: number, h: number) => { if (s.failSize) throw new Error("FloatingLines: resize denied"); this.gl.drawingBufferWidth = Math.round(w * this.dpr); this.gl.drawingBufferHeight = Math.round(h * this.dpr); };
    render = () => { s.renders += 1; s.snapshots.push((s.progs[0].uniforms.lineGradient.value as Float32Array[]).map((stop) => Array.from(stop))); };
    constructor(options: Record<string, unknown> = {}) { this.options = options; this.dpr = typeof options.dpr === "number" ? options.dpr : 1; s.rends.push(this); }
  }
  class Program {
    remove = () => { /* noop */ };
    constructor(_gl: unknown, o: Prog) { s.progs.push({ ...o }); }
  }
  class Triangle { remove = () => { /* noop */ }; }
  class Mesh {}
  return { Renderer, Program, Triangle, Mesh };
});

beforeEach(() => {
  media.desktop = true;
  media.reduced = false;
  // jsdom shares one documentElement across tests: never inherit a theme.
  document.documentElement.classList.remove("dark");
  document.documentElement.removeAttribute("data-theme");
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: q === FLOATING_LINES_MEDIA_QUERIES.desktop ? media.desktop : q === FLOATING_LINES_MEDIA_QUERIES.reducedMotion ? media.reduced : true, addEventListener: () => {}, removeEventListener: () => {} }));
  vi.stubGlobal("ResizeObserver", class { observe() { /* noop */ } disconnect() { s.disconnected += 1; } });
  vi.stubGlobal("requestAnimationFrame", (cb: () => void) => { s.raf.push(cb); return s.raf.length; });
  vi.stubGlobal("cancelAnimationFrame", () => { s.cancelled += 1; });
  const add = window.addEventListener.bind(window);
  vi.spyOn(window, "addEventListener").mockImplementation((type, listener, options) => { if (type === "mousemove") s.added.push(type); add(type, listener, options); });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  Object.assign(s, { rends: [], progs: [], renders: 0, raf: [], cancelled: 0, lost: 0, disconnected: 0, added: [], snapshots: [], failSize: false });
});

const hostOf = (c: HTMLElement) => c.querySelector("[data-floating-lines-host]") as HTMLElement;
const channelOf = (hex: string, offset: number) => Number.parseInt(hex.replace("#", "").slice(offset, offset + 2), 16) / 255;
const expectStops = (actual: ArrayLike<ArrayLike<number>>, hexes: readonly string[]) => hexes.forEach((hex, i) => [0, 2, 4].forEach((o, c) => expect(actual[i][c]).toBeCloseTo(channelOf(hex, o), 5)));

it("mounts one animated desktop canvas with frozen shaders/config/gradient, then tears down", async () => {
  vi.stubGlobal("devicePixelRatio", 3);
  const { container, unmount } = render(<FloatingLines variant="employer" />);
  const host = hostOf(container);
  await waitFor(() => expect(host.querySelector("canvas")).not.toBeNull());
  expect(host).toHaveAttribute("aria-hidden", "true"); expect(host).toHaveAttribute("data-floating-lines-state", "ready-animated");
  expect(container.querySelectorAll("canvas")).toHaveLength(1);
  expect(s.rends).toHaveLength(1);
  expect(s.rends[0].options).toMatchObject({ alpha: false, antialias: true, dpr: 2 });
  expect(s.raf).toHaveLength(1);
  expect(s.progs[0].vertex).toBe(FLOATING_LINES_OGL_VERTEX_SHADER); expect(s.progs[0].fragment).toBe(FLOATING_LINES_OGL_FRAGMENT_SHADER);
  const u = s.progs[0].uniforms;
  expect(u.animationSpeed.value).toBe(FLOATING_LINES_CONFIG.animationSpeed);
  expect(u.topLineCount.value).toBe(FLOATING_LINES_CONFIG.lineCount);
  expect((u.bottomWavePosition.value as Float32Array)[0]).toBe(FLOATING_LINES_CONFIG.bot[0]);
  expect((u.bottomWavePosition.value as Float32Array)[1]).toBeCloseTo(FLOATING_LINES_CONFIG.bot[1], 5);
  expect(u.lineGradientCount.value).toBe(3);
  const gradient = u.lineGradient.value as Float32Array[];
  expect(gradient).toHaveLength(8);
  expect(gradient.slice(3).every((stop) => stop.every((channel) => channel === 1))).toBe(true);
  const canvas = host.querySelector("canvas") as HTMLCanvasElement;
  unmount();
  expect(document.body.contains(canvas)).toBe(false);
  expect(s.cancelled).toBeGreaterThan(0); expect(s.disconnected).toBeGreaterThan(0);
  expect(s.lost).toBe(1);
});

it("stays hidden with no renderer, canvas or RAF below the desktop gate", () => {
  media.desktop = false;
  const { container } = render(<FloatingLines variant="candidate" />);
  expect(hostOf(container)).toHaveAttribute("data-floating-lines-state", "hidden");
  expect(container.querySelector("canvas")).toBeNull();
  expect(s.rends).toHaveLength(0);
  expect(s.raf).toHaveLength(0);
});

it("renders one themed static frame at time 4 with no RAF or pointer listeners, then re-renders on theme change", async () => {
  media.reduced = true;
  const { container } = render(<FloatingLines variant="candidate" />);
  const host = hostOf(container);
  await waitFor(() => expect(host.querySelector("canvas")).not.toBeNull());
  expect(host).toHaveAttribute("data-floating-lines-state", "ready-static");
  expect(s.progs[0].uniforms.iTime.value).toBe(FLOATING_LINES_REDUCED_MOTION_FRAME_TIME);
  expect(s.renders).toBe(1);
  expect(s.raf).toHaveLength(0);
  expect(s.added).not.toContain("mousemove");
  // The FIRST static frame already carries the candidate dark palette, with no
  // filter and the original `screen` blend.
  expectStops(s.snapshots[0], FLOATING_LINES_VARIANTS.candidate.darkGradient);
  expect(host.style.mixBlendMode).toBe("screen");
  expect(host.style.filter).toBe("");
  act(() => {
    document.documentElement.classList.remove("dark");
    document.documentElement.setAttribute("data-theme", "light");
  });
  await waitFor(() => expect(s.renders).toBe(2));
  // Literal reference parity: light keeps the host unfiltered and feeds the raw
  // committed light palette exactly (no per-channel complement).
  expect(host.style.mixBlendMode).toBe("multiply");
  expect(host.style.filter).toBe("");
  expectStops(s.snapshots[1], FLOATING_LINES_VARIANTS.candidate.lightPalette);
  // Switching back to dark restores `screen` and the exact dark gradient.
  act(() => {
    document.documentElement.classList.add("dark");
    document.documentElement.setAttribute("data-theme", "dark");
  });
  await waitFor(() => expect(s.renders).toBe(3));
  expect(host.style.mixBlendMode).toBe("screen");
  expect(host.style.filter).toBe("");
  expectStops(s.snapshots[2], FLOATING_LINES_VARIANTS.candidate.darkGradient);
});

it("applies multiply with the raw light palette and no host filter, then clears on dispose", async () => {
  const { container, unmount } = render(<FloatingLines variant="employer" />);
  const host = hostOf(container);
  await waitFor(() => expect(host.querySelector("canvas")).not.toBeNull());
  // Default resolved theme here is dark: exact committed uniforms, no filter.
  expect(host.style.mixBlendMode).toBe("screen");
  expect(host.style.filter).toBe("");
  expectStops(s.progs[0].uniforms.lineGradient.value as Float32Array[], FLOATING_LINES_VARIANTS.employer.darkGradient);
  act(() => {
    document.documentElement.setAttribute("data-theme", "light");
  });
  await waitFor(() => expect(host.style.mixBlendMode).toBe("multiply"));
  expect(host.style.filter).toBe("");
  expectStops(
    s.progs[0].uniforms.lineGradient.value as Float32Array[],
    FLOATING_LINES_VARIANTS.employer.lightPalette,
  );
  unmount();
  expect(host.style.mixBlendMode).toBe("");
  expect(host.style.filter).toBe("");
});

it("clears the blend style when initialization fails after theming", async () => {
  document.documentElement.classList.remove("dark");
  document.documentElement.setAttribute("data-theme", "light");
  s.failSize = true;
  const warn = vi.spyOn(console, "warn").mockImplementation(() => { /* expected diagnostic */ });
  const { container } = render(<FloatingLines variant="candidate" />);
  const host = hostOf(container);
  await waitFor(() => expect(host).toHaveAttribute("data-floating-lines-state", "failed"));
  // applyTheme ran before the throw, so the blend style must be reset by
  // cleanup; no host filter is ever applied in either theme.
  expect(host.style.mixBlendMode).toBe("");
  expect(host.style.filter).toBe("");
  expect(host.querySelector("canvas")).toBeNull();
  expect(warn).toHaveBeenCalled();
  warn.mockRestore();
});
