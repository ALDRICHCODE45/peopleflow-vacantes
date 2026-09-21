"use client";

import * as React from "react";
import { Mesh, Program, Renderer, Triangle } from "ogl";

import { SYSTEM_DARK_QUERY, type ResolvedTheme } from "../theme/theme-preferences";
import {
  FLOATING_LINES_CONFIG,
  FLOATING_LINES_MEDIA_QUERIES,
  FLOATING_LINES_OGL_FRAGMENT_SHADER,
  FLOATING_LINES_OGL_VERTEX_SHADER,
  FLOATING_LINES_REDUCED_MOTION_FRAME_TIME,
  FLOATING_LINES_VARIANTS,
  type FloatingLinesVariant,
} from "./floating-lines-shaders";

// CCP-R7D2B — standalone, unintegrated OGL client leaf for the login
// FloatingLines panel (integration is CCP-R7D2C). The frozen shader/config
// module owns the reference bytes; this leaf feeds them into one ogl Triangle +
// Program + Mesh on an opaque antialiased Renderer (DPR capped at 2). No WebGL
// below the frozen 1024px gate; reduced motion renders one frozen static frame;
// the resolved root theme selects the variant's dark/light palette BEFORE it.
// Any failure degrades to `failed`; the static shell fallback stays external.

type VisualHandle = { applyTheme: (theme: ResolvedTheme) => void; dispose: () => void };
const DPR_CAP = 2;

function readResolvedTheme(): ResolvedTheme {
  const root = document.documentElement;
  if (root.classList.contains("dark")) return "dark";
  const explicit = root.getAttribute("data-theme");
  if (explicit === "light" || explicit === "dark") return explicit;
  return window.matchMedia(SYSTEM_DARK_QUERY).matches ? "dark" : "light";
}

/** Exact reference `hex` helper, as a vec3 triple. */
function hexToRgb(value: string): [number, number, number] {
  const hex = value.replace("#", "");
  return [
    Number.parseInt(hex.slice(0, 2), 16) / 255,
    Number.parseInt(hex.slice(2, 4), 16) / 255,
    Number.parseInt(hex.slice(4, 6), 16) / 255,
  ];
}

function buildFloatingLines(
  host: HTMLDivElement,
  options: { variant: FloatingLinesVariant; reducedMotion: boolean; theme: ResolvedTheme },
): VisualHandle {
  const cfg = FLOATING_LINES_CONFIG;
  const reducedMotion = options.reducedMotion;
  // Reverse-order cleanup: any throw after the canvas is attached tears down
  // exactly what was acquired, so nothing leaks.
  const cleanups: Array<() => void> = [];
  const runCleanups = () => {
    for (let index = cleanups.length - 1; index >= 0; index -= 1) cleanups[index]();
    cleanups.length = 0;
  };
  let frameId = 0;

  try {
    const renderer = new Renderer({
      alpha: false,
      antialias: true,
      dpr: Math.min(window.devicePixelRatio || 1, DPR_CAP),
    });
    const gl = renderer.gl;
    if (!gl) throw new Error("FloatingLines: no WebGL context available");
    gl.clearColor(0, 0, 0, 1);
    const canvas = gl.canvas;
    host.appendChild(canvas);
    cleanups.push(() => {
      if (canvas.parentNode === host) host.removeChild(canvas);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    });

    const geometry = new Triangle(gl);
    cleanups.push(() => geometry.remove());

    // 8 entries: the variant's 3 palette colours plus five white stops.
    const gradient = Array.from({ length: 8 }, () => new Float32Array([1, 1, 1]));
    const uniform = <T,>(value: T) => ({ value });
    const uniforms = {
      iTime: uniform(0),
      iResolution: uniform(new Float32Array([1, 1, 1])),
      animationSpeed: uniform(cfg.animationSpeed),
      topLineCount: uniform(cfg.lineCount),
      middleLineCount: uniform(cfg.lineCount),
      bottomLineCount: uniform(cfg.lineCount),
      topLineDistance: uniform(cfg.lineDistance),
      middleLineDistance: uniform(cfg.lineDistance),
      bottomLineDistance: uniform(cfg.lineDistance),
      topWavePosition: uniform(new Float32Array(cfg.top)),
      middleWavePosition: uniform(new Float32Array(cfg.mid)),
      bottomWavePosition: uniform(new Float32Array(cfg.bot)),
      iMouse: uniform(new Float32Array([-1000, -1000])),
      bendRadius: uniform(cfg.bendRadius),
      bendStrength: uniform(cfg.bendStrength),
      bendInfluence: uniform(0),
      parallaxOffset: uniform(new Float32Array([0, 0])),
      lineGradient: uniform(gradient),
      lineGradientCount: uniform(FLOATING_LINES_VARIANTS[options.variant].darkGradient.length),
    };
    const program = new Program(gl, {
      vertex: FLOATING_LINES_OGL_VERTEX_SHADER,
      fragment: FLOATING_LINES_OGL_FRAGMENT_SHADER,
      uniforms,
    });
    cleanups.push(() => program.remove());
    const mesh = new Mesh(gl, { geometry, program });

    const targetMouse = new Float32Array([-1000, -1000]);
    const currentMouse = new Float32Array([-1000, -1000]);
    const targetParallax = new Float32Array([0, 0]);
    const currentParallax = new Float32Array([0, 0]);
    let targetInfluence = 0;
    let currentInfluence = 0;

    const resize = () => {
      renderer.setSize(host.clientWidth || 1, host.clientHeight || 1);
      // Device-pixel resolution: iResolution is the drawing buffer size.
      uniforms.iResolution.value[0] = gl.drawingBufferWidth || canvas.width || 1;
      uniforms.iResolution.value[1] = gl.drawingBufferHeight || canvas.height || 1;
      uniforms.iResolution.value[2] = 1;
      if (reducedMotion) renderer.render({ scene: mesh });
    };
    // `draw=false` at init lets resize() render the FIRST static frame already
    // carrying the selected palette, instead of the default white gradient.
    const applyTheme = (theme: ResolvedTheme, draw = true) => {
      const light = theme === "light";
      // Literal reference parity with `applyShaderTheme`: light composites with
      // `multiply` over the warm page and dark with `screen` over black, and the
      // committed palette for the theme is fed to the shader RAW. No host filter
      // and no channel transform exists in either theme.
      host.style.mixBlendMode = light ? "multiply" : "screen";
      const stops = light
        ? FLOATING_LINES_VARIANTS[options.variant].lightPalette
        : FLOATING_LINES_VARIANTS[options.variant].darkGradient;
      stops.forEach((value, index) => {
        const [r, g, b] = hexToRgb(value);
        gradient[index].set([r, g, b]);
      });
      // Reduced motion has no RAF loop: redraw its single static frame here.
      if (draw && reducedMotion) renderer.render({ scene: mesh });
    };
    // Frozen representative mid-animation frame; t=0 is overexposed.
    if (reducedMotion) uniforms.iTime.value = FLOATING_LINES_REDUCED_MOTION_FRAME_TIME;
    applyTheme(options.theme, false);
    resize();
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(host);
    cleanups.push(() => resizeObserver.disconnect());

    const loop = (time: number) => {
      frameId = window.requestAnimationFrame(loop);
      uniforms.iTime.value = time * 0.001;
      for (let axis = 0; axis < 2; axis += 1) {
        currentMouse[axis] += (targetMouse[axis] - currentMouse[axis]) * cfg.mouseDamping;
        uniforms.iMouse.value[axis] = currentMouse[axis];
        currentParallax[axis] += (targetParallax[axis] - currentParallax[axis]) * cfg.mouseDamping;
        uniforms.parallaxOffset.value[axis] = currentParallax[axis];
      }
      currentInfluence += (targetInfluence - currentInfluence) * cfg.mouseDamping;
      uniforms.bendInfluence.value = currentInfluence;
      renderer.render({ scene: mesh });
    };

    if (!reducedMotion) {
      const onMouseMove = (event: MouseEvent) => {
        const rect = canvas.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const y = event.clientY - rect.top;
        targetMouse[0] = x * renderer.dpr;
        targetMouse[1] = (rect.height - y) * renderer.dpr;
        targetInfluence = 1;
        targetParallax[0] = ((x - rect.width / 2) / rect.width) * cfg.parallaxStrength;
        targetParallax[1] = -((y - rect.height / 2) / rect.height) * cfg.parallaxStrength;
      };
      const onPointerLeave = () => {
        targetInfluence = 0;
      };
      window.addEventListener("mousemove", onMouseMove, { passive: true });
      cleanups.push(() => window.removeEventListener("mousemove", onMouseMove));
      host.addEventListener("pointerleave", onPointerLeave);
      cleanups.push(() => host.removeEventListener("pointerleave", onPointerLeave));
      frameId = window.requestAnimationFrame(loop);
    }

    // Idempotent: unmount racing a media restart must not double-free.
    let disposed = false;
    return {
      applyTheme,
      dispose: () => {
        if (disposed) return;
        disposed = true;
        if (frameId) window.cancelAnimationFrame(frameId);
        runCleanups();
        host.style.mixBlendMode = "";
      },
    };
  } catch (error) {
    if (frameId) window.cancelAnimationFrame(frameId);
    try {
      runCleanups();
    } catch {
      // Teardown must never mask the original initialization failure.
    }
    host.style.mixBlendMode = "";
    throw error;
  }
}

/** Desktop-only WebGL decoration; every failure path keeps the static shell. */
export function FloatingLines({
  variant,
  className,
}: {
  variant: FloatingLinesVariant;
  className?: string;
}) {
  const hostRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let active: VisualHandle | null = null;
    let generation = 0;
    let cancelled = false;

    const desktopMedia = window.matchMedia(FLOATING_LINES_MEDIA_QUERIES.desktop);
    const reducedMotionMedia = window.matchMedia(FLOATING_LINES_MEDIA_QUERIES.reducedMotion);
    // Theme reuse: observe the shared bootstrap/ThemeToggle document state.
    const themeObserver = new MutationObserver(() => {
      if (active) active.applyTheme(readResolvedTheme());
    });
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme", "class"],
    });

    const start = (snapshot: number) => {
      if (cancelled || snapshot !== generation) return;
      if (!desktopMedia.matches) {
        // Below the frozen desktop gate the panel is hidden: never init WebGL.
        host.setAttribute("data-floating-lines-state", "hidden");
        return;
      }
      host.setAttribute("data-floating-lines-state", "initializing");
      const reducedMotion = reducedMotionMedia.matches;
      try {
        active = buildFloatingLines(host, { variant, reducedMotion, theme: readResolvedTheme() });
        host.setAttribute(
          "data-floating-lines-state",
          reducedMotion ? "ready-static" : "ready-animated",
        );
      } catch (error) {
        // Partial initialization is already torn down; nothing propagates uncaught.
        console.warn("FloatingLines: WebGL initialization failed", error);
        active = null;
        host.setAttribute("data-floating-lines-state", "failed");
      }
    };
    const restart = () => {
      generation += 1;
      if (active) active.dispose();
      active = null;
      start(generation);
    };

    desktopMedia.addEventListener("change", restart);
    reducedMotionMedia.addEventListener("change", restart);
    start(generation);

    return () => {
      cancelled = true;
      generation += 1;
      themeObserver.disconnect();
      desktopMedia.removeEventListener("change", restart);
      reducedMotionMedia.removeEventListener("change", restart);
      if (active) active.dispose();
      active = null;
    };
  }, [variant]);

  return (
    <div
      ref={hostRef}
      data-floating-lines-host=""
      data-floating-lines-state="initializing"
      aria-hidden="true"
      className={`absolute inset-0 ${className ?? ""}`.trim()}
    />
  );
}
