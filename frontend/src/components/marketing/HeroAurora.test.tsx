import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, render, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Hoisted so the vi.mock factory can reach the shared doubles without
// depending on module initialisation order. jsdom has no WebGL context, so the
// ogl renderer is doubled here; these tests do not prove real GPU behaviour.
const oglDouble = vi.hoisted(() => ({
  failRenderer: false,
  failProgram: false,
  resize: null as (() => void) | null,
  renderers: [] as Array<{
    options: Record<string, unknown>;
    dpr: number;
    gl: {
      canvas: HTMLCanvasElement;
      getExtension: ReturnType<typeof vi.fn>;
      clearColor: ReturnType<typeof vi.fn>;
      drawingBufferWidth: number;
      drawingBufferHeight: number;
    };
    setSize: ReturnType<typeof vi.fn>;
    render: ReturnType<typeof vi.fn>;
  }>,
  programs: [] as Array<Record<string, { value: unknown }>>,
}));

vi.mock("ogl", () => {
  class MockRenderer {
    gl: {
      canvas: HTMLCanvasElement;
      getExtension: ReturnType<typeof vi.fn>;
      clearColor: ReturnType<typeof vi.fn>;
      drawingBufferWidth: number;
      drawingBufferHeight: number;
    };
    options: Record<string, unknown>;
    dpr = 1;
    setSize = vi.fn((width: number, height: number) => {
      this.gl.canvas.width = Math.floor(width * this.dpr);
      this.gl.canvas.height = Math.floor(height * this.dpr);
    });
    render = vi.fn();
    constructor(options: Record<string, unknown> = {}) {
      if (oglDouble.failRenderer) throw new Error("WebGL unavailable");
      this.options = options;
      const canvas = document.createElement("canvas");
      const gl = {
        canvas,
        clearColor: vi.fn(),
        getExtension: vi.fn(() => ({ loseContext: vi.fn() })),
        drawingBufferWidth: 580,
        drawingBufferHeight: 420,
      };
      this.gl = gl;
      oglDouble.renderers.push(this);
    }
  }
  class MockProgram {
    remove = vi.fn();
    uniforms: Record<string, { value: unknown }>;
    constructor(
      _gl: unknown,
      options: { uniforms: Record<string, { value: unknown }> },
    ) {
      if (oglDouble.failProgram) throw new Error("Program unavailable");
      this.uniforms = options.uniforms;
      oglDouble.programs.push(this.uniforms);
    }
  }
  class MockMesh {}
  class MockTriangle { remove = vi.fn(); }
  return {
    Renderer: MockRenderer,
    Program: MockProgram,
    Mesh: MockMesh,
    Triangle: MockTriangle,
  };
});

import { HeroAurora } from "@/components/marketing/HeroAurora";

const auroraSource = readFileSync(
  join(process.cwd(), "src/components/marketing/HeroAurora.tsx"),
  "utf8",
);

type MediaController = {
  emit: (matches: boolean) => void;
};

function stubMatchMedia(initialReducedMotion: boolean): MediaController {
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(300);
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(300);
  vi.stubGlobal("ResizeObserver", class {
    constructor(callback: () => void) { oglDouble.resize = callback; }
    observe() {} disconnect() {}
  });
  const listeners = new Set<(event: MediaQueryListEvent) => void>();
  let reducedMotion = initialReducedMotion;
  const controller: MediaController = {
    emit(matches) {
      reducedMotion = matches;
      listeners.forEach((listener) =>
        listener({ matches } as MediaQueryListEvent),
      );
    },
  };
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => {
      const tracksReducedMotion = query.includes("reduced-motion");
      return {
        get matches() {
          return tracksReducedMotion ? reducedMotion : false;
        },
        media: query,
        addEventListener: vi.fn(
          (_event: string, listener: (event: MediaQueryListEvent) => void) => {
            listeners.add(listener);
          },
        ),
        removeEventListener: vi.fn(
          (_event: string, listener: (event: MediaQueryListEvent) => void) => {
            listeners.delete(listener);
          },
        ),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      };
    }),
  );
  return controller;
}

afterEach(() => {
  document.documentElement.classList.remove("dark");
  document.documentElement.removeAttribute("data-theme");
  oglDouble.failRenderer = false;
  oglDouble.failProgram = false;
  oglDouble.resize = null;
  vi.restoreAllMocks();
  oglDouble.renderers.length = 0;
  oglDouble.programs.length = 0;
  vi.unstubAllGlobals();
});

describe("HeroAurora", () => {
  it("renders the reference aurora host element", () => {
    stubMatchMedia(false);
    render(<HeroAurora />);

    const host = document.getElementById("heroAurora");
    expect(host).not.toBeNull();
    expect(host).toHaveAttribute("data-pf-hero-aurora");
  });

  it("mounts the OGL renderer and appends the WebGL canvas", async () => {
    stubMatchMedia(false);
    render(<HeroAurora />);

    const host = document.getElementById("heroAurora")!;
    await waitFor(() => {
      expect(host.querySelector("canvas")).not.toBeNull();
    });
    expect(oglDouble.renderers).toHaveLength(1);
    expect(oglDouble.programs).toHaveLength(1);
  });

  it("keeps the static fallback when reduced motion is preferred", () => {
    stubMatchMedia(true);
    render(<HeroAurora />);

    const host = document.getElementById("heroAurora")!;
    expect(host).toHaveAttribute("data-static", "true");
    expect(host.querySelector("canvas")).toBeNull();
    expect(oglDouble.renderers).toHaveLength(0);
  });

  it("tears the renderer down when the motion preference flips to reduced", async () => {
    const media = stubMatchMedia(false);
    render(<HeroAurora />);

    const host = document.getElementById("heroAurora")!;
    await waitFor(() => {
      expect(host.querySelector("canvas")).not.toBeNull();
    });

    await act(async () => {
      media.emit(true);
    });

    await waitFor(() => {
      expect(host.querySelector("canvas")).toBeNull();
    });
    expect(host).toHaveAttribute("data-static", "true");
  });

  it("binds the canvas blend mode to the resolved root theme", async () => {
    stubMatchMedia(false);
    document.documentElement.classList.add("dark");

    const { unmount } = render(<HeroAurora />);

    const host = document.getElementById("heroAurora")!;
    await waitFor(() => {
      expect(host.style.mixBlendMode).toBe("screen");
    });

    await act(async () => {
      document.documentElement.classList.remove("dark");
      document.documentElement.setAttribute("data-theme", "light");
    });

    await waitFor(() => {
      expect(host.style.mixBlendMode).toBe("multiply");
    });
    unmount();
  });

  it("cleans the renderer up on unmount", async () => {
    stubMatchMedia(false);
    const { unmount } = render(<HeroAurora />);

    const host = document.getElementById("heroAurora")!;
    const canvas = await waitFor(() => {
      const found = host.querySelector("canvas");
      expect(found).not.toBeNull();
      return found!;
    });

    const renderer = oglDouble.renderers[0];
    unmount();

    expect(canvas.parentNode).toBeNull();
    expect(renderer.gl.getExtension).toHaveBeenCalledWith(
      "WEBGL_lose_context",
    );
  });

  it.each([
    ["employer", false, "#7B22C9", "#5B1899"],
    ["employer", true, "#C89BFF", "#9336EA"],
    ["candidate", false, "#0E8FA5", "#7B22C9"],
    ["candidate", true, "#22d3ee", "#9336ea"],
  ] as const)("uses %s colors (dark=%s) without changing animation parameters", (audience, dark, color1, color2) => {
    stubMatchMedia(false);
    document.documentElement.classList.toggle("dark", dark);
    render(<HeroAurora audience={audience} />);
    const vector = (hex: string) => [1, 3, 5].map((start) => parseInt(hex.slice(start, start + 2), 16) / 255);
    const uniforms = oglDouble.programs[0];
    expect(uniforms.uColor1.value).toEqual(vector(color1));
    expect(uniforms.uColor2.value).toEqual(vector(color2));
    expect(uniforms.uSpeed.value).toBe(0.5);
    expect(uniforms.uScale.value).toBe(1.4);
    expect(uniforms.uNoiseFreq.value).toBe(2.5);
    expect(uniforms.uBrightness.value).toBe(dark ? 0.95 : 0.7);
    expect(uniforms.uBandHeight.value).toBe(dark ? 0.5 : 0.55);
    expect(uniforms.uBandSpread.value).toBe(dark ? 1 : 0.85);
  });

  it("updates candidate colors with the theme and preserves screen/multiply blending", async () => {
    stubMatchMedia(false);
    render(<HeroAurora audience="candidate" />);
    const host = document.getElementById("heroAurora")!;
    expect(host).toHaveAttribute("data-audience", "candidate");
    expect(host.style.mixBlendMode).toBe("multiply");
    await act(async () => document.documentElement.classList.add("dark"));
    expect(host.style.mixBlendMode).toBe("screen");
    expect(oglDouble.programs[0].uColor1.value).toEqual([34 / 255, 211 / 255, 238 / 255]);
  });

  it("retains the candidate accent in the reduced-motion host without WebGL", () => {
    stubMatchMedia(true);
    render(<HeroAurora audience="candidate" />);
    expect(document.getElementById("heroAurora")).toHaveAttribute("data-audience", "candidate");
    expect(document.getElementById("heroAurora")).toHaveAttribute("data-static", "true");
    expect(oglDouble.renderers).toHaveLength(0);
  });

  it("caps the hero framebuffer without changing its CSS geometry", () => {
    stubMatchMedia(false);
    vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(1600);
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(1000);
    render(<HeroAurora />);
    const renderer = oglDouble.renderers[0];
    expect(renderer.options).toMatchObject({ alpha: false, antialias: false, depth: false });
    expect(renderer.dpr).toBe(0.5);
    expect(renderer.gl.canvas.width * renderer.gl.canvas.height).toBeLessThanOrEqual(400_000);
  });

  it("uses a static gradient when WebGL creation fails", () => {
    stubMatchMedia(false);
    oglDouble.failRenderer = true;
    render(<HeroAurora />);
    expect(document.getElementById("heroAurora")).toHaveAttribute("data-static", "true");
  });

  it("removes a lost context and restores the static fallback", () => {
    stubMatchMedia(false);
    render(<HeroAurora audience="candidate" />);
    const host = document.getElementById("heroAurora")!;
    act(() => host.querySelector("canvas")!.dispatchEvent(new Event("webglcontextlost", { cancelable: true })));
    expect(host.querySelector("canvas")).toBeNull();
    expect(host).toHaveAttribute("data-static", "true");
  });

  it("cleans up and keeps the static fallback after a program creation failure", () => {
    stubMatchMedia(false);
    oglDouble.failProgram = true;
    render(<HeroAurora />);
    expect(document.getElementById("heroAurora")).toHaveAttribute("data-static", "true");
    expect(document.querySelector("canvas")).toBeNull();
    expect(oglDouble.renderers[0].gl.getExtension).toHaveBeenCalledWith("WEBGL_lose_context");
  });

  it("resizes with its element and keeps zero-sized hosts out of resolution uniforms", () => {
    stubMatchMedia(false);
    let width = 800;
    let height = 500;
    vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(() => width);
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(() => height);
    render(<HeroAurora />);
    expect(oglDouble.programs[0].uResolution.value).toEqual([800, 500, 1.6]);
    width = 400;
    act(() => oglDouble.resize?.());
    expect(oglDouble.programs[0].uResolution.value).toEqual([400, 500, 0.8]);
    height = 0;
    act(() => oglDouble.resize?.());
    expect((oglDouble.programs[0].uResolution.value as number[]).every(Number.isFinite)).toBe(true);
    expect(oglDouble.renderers[0].gl.canvas.height).toBeGreaterThan(0);
  });

  it("keeps the reference shader interface and opaque OGL context", () => {
    expect(auroraSource).toContain("new Renderer({ alpha: false,");
    expect(auroraSource).toContain("#define TAU 6.28318");
    expect(auroraSource).toContain(
      "float auroraGlow(float t, vec2 shift)",
    );
    expect(auroraSource).toContain("uniform float uLightBlend;");
    expect(auroraSource).toContain("uniform float uOctaveDecay;");
  });
});
