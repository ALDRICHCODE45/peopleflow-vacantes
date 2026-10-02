import { afterEach, describe, expect, it, vi } from "vitest";
import { decorativeDpr, motionDamping, startDecorativeAnimation } from "./webgl-animation";

afterEach(() => { delete document.documentElement.dataset.pfThemeVt; vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("decorative WebGL budget", () => {
  it("caps Retina and large displays at one sample per CSS pixel and 400k pixels", () => {
    for (const [width, height, dpr] of [[700, 1000, 2], [2560, 1440, 2], [1280, 900, 1], [300, 300, 3]]) {
      const scale = decorativeDpr(width, height, dpr);
      expect(scale).toBeLessThanOrEqual(1);
      expect(Math.floor(width * scale) * Math.floor(height * scale)).toBeLessThanOrEqual(400_000);
    }
    expect(decorativeDpr(0, 0, 2)).toBe(1);
  });

  it("keeps cursor damping consistent across frame rates", () => {
    const at60 = motionDamping(1000 / 60);
    const at30 = motionDamping(1000 / 30);
    expect(at60).toBeCloseTo(0.05);
    expect(1 - Math.pow(1 - at60, 2)).toBeCloseTo(at30);
    expect(motionDamping(100)).toBeGreaterThan(at30);
    expect(motionDamping(10_000)).toBeLessThan(1);
  });

  it("yields to the theme reveal and resumes once without reviving a disposed loop", async () => {
    const queue = new Map<number, FrameRequestCallback>();
    let id = 0;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { queue.set(++id, callback); return id; });
    vi.stubGlobal("cancelAnimationFrame", (key: number) => queue.delete(key));
    const draw = vi.fn();
    const stop = startDecorativeAnimation(document.createElement("div"), draw);
    try {
      expect(queue.size).toBe(1);
      document.documentElement.dataset.pfThemeVt = "active";
      await Promise.resolve();
      expect(queue.size).toBe(0);
      expect(draw).not.toHaveBeenCalled();
      delete document.documentElement.dataset.pfThemeVt;
      await Promise.resolve();
      expect(queue.size).toBe(1);
      stop();
      document.documentElement.dataset.pfThemeVt = "active";
      delete document.documentElement.dataset.pfThemeVt;
      await Promise.resolve();
      expect(queue.size).toBe(0);
    } finally { stop(); }
  });

  it("does not queue frames when mounted during an active theme reveal", () => {
    document.documentElement.dataset.pfThemeVt = "active";
    const raf = vi.fn(() => 1);
    vi.stubGlobal("requestAnimationFrame", raf);
    const stop = startDecorativeAnimation(document.createElement("div"), vi.fn());
    try { expect(raf).not.toHaveBeenCalled(); } finally { stop(); }
  });

  it("limits draws to 30 FPS, pauses hidden/offscreen and cancels on disposal", () => {
    let hidden = false;
    vi.spyOn(document, "hidden", "get").mockImplementation(() => hidden);
    const queue = new Map<number, FrameRequestCallback>();
    let id = 0;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { queue.set(++id, callback); return id; });
    vi.stubGlobal("cancelAnimationFrame", (key: number) => queue.delete(key));
    let visibility!: (visible: boolean) => void;
    const disconnect = vi.fn();
    vi.stubGlobal("IntersectionObserver", class {
      constructor(callback: IntersectionObserverCallback) { visibility = (visible) => callback([{ isIntersecting: visible } as IntersectionObserverEntry], this as unknown as IntersectionObserver); }
      observe() {} disconnect = disconnect;
    });
    const tick = (time: number) => { const callbacks = [...queue.values()]; queue.clear(); callbacks.forEach(callback => callback(time)); };
    const draw = vi.fn();
    const stop = startDecorativeAnimation(document.createElement("div"), draw);
    for (const time of [0, 8, 16, 24, 34, 42, 50, 58, 67]) tick(time);
    expect(draw).toHaveBeenCalledTimes(3);
    expect(draw.mock.calls[1][1]).toBe(34);
    hidden = true;
    document.dispatchEvent(new Event("visibilitychange"));
    expect(queue.size).toBe(0);
    hidden = false;
    document.dispatchEvent(new Event("visibilitychange"));
    expect(queue.size).toBe(1);
    visibility(false);
    expect(queue.size).toBe(0);
    visibility(true);
    tick(400);
    expect(draw).toHaveBeenCalledTimes(4);
    stop(); stop();
    expect(queue.size).toBe(0);
    expect(disconnect).toHaveBeenCalledOnce();
    document.dispatchEvent(new Event("visibilitychange"));
    expect(queue.size).toBe(0);
  });
});
