// Decorative backgrounds should not spend a Retina framebuffer or render at
// the monitor's full refresh rate. Keep CSS geometry; only sample density falls.
const MAX_PIXELS = 400_000;
const FRAME_MS = 1000 / 30;

export function decorativeDpr(width: number, height: number, deviceDpr = 1): number {
  return Math.min(deviceDpr || 1, 1, Math.sqrt(MAX_PIXELS / Math.max(1, width * height)));
}

/** Equivalent to the original 0.05 damping at 60 FPS, independent of frame rate. */
export function motionDamping(deltaMs: number, at60Fps = 0.05): number {
  return 1 - Math.pow(1 - at60Fps, Math.min(Math.max(deltaMs, 0), 250) / (1000 / 60));
}

/** Own one cancellable loop; stop GPU work while hidden or outside the viewport. */
export function startDecorativeAnimation(
  host: HTMLElement,
  draw: (timeMs: number, deltaMs: number) => void,
): () => void {
  let frame: number | null = null;
  let previous: number | null = null;
  let visible = true;
  let disposed = false;

  const cancel = () => {
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
    previous = null;
  };
  const tick = (time: number) => {
    frame = null;
    if (disposed || document.hidden || !visible) return;
    const delta = previous === null ? FRAME_MS : time - previous;
    if (delta >= FRAME_MS - 0.5) {
      previous = time;
      draw(time, delta);
    }
    if (!disposed) frame = requestAnimationFrame(tick);
  };
  const updateVisibility = () => {
    if (disposed) return;
    if (document.hidden || !visible) cancel();
    else if (frame === null) frame = requestAnimationFrame(tick);
  };
  const observer = typeof IntersectionObserver === "undefined" ? null : new IntersectionObserver(([entry]) => {
    if (!entry) return;
    visible = entry.isIntersecting;
    updateVisibility();
  });
  observer?.observe(host);
  document.addEventListener("visibilitychange", updateVisibility);
  updateVisibility();

  return () => {
    if (disposed) return;
    disposed = true;
    cancel();
    observer?.disconnect();
    document.removeEventListener("visibilitychange", updateVisibility);
  };
}
