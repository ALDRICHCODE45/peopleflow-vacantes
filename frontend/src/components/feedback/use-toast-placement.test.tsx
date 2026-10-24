import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getToastOffsets, useToastPlacement } from "./use-toast-placement";

const rect = (left: number, top = 0, bottom = 800) => ({ left, top, bottom, height: bottom - top });

describe("toast geometry", () => {
  it("leaves offsets at their CSS defaults without a sheet", () => {
    expect(getToastOffsets(null, null, 1200, 350, 800)).toEqual({});
  });
  it("moves left of a right sheet with enough room", () => {
    expect(getToastOffsets(rect(640), rect(640, 720), 1200, 350, 800)).toEqual({ right: 572 });
  });
  it("rises above the footer when the sheet fills the viewport", () => {
    expect(getToastOffsets(rect(0), rect(0, 720), 390, 342, 800)).toEqual({ bottom: 92 });
  });
  it("accounts for an inset footer and requires gaps on both sides", () => {
    expect(getToastOffsets(rect(370), rect(370, 700, 784), 1000, 350, 800)).toEqual({ bottom: 112 });
    expect(getToastOffsets(rect(374), null, 1000, 350, 800)).toEqual({ right: 638 });
  });
});

let sheets: HTMLElement[];
let resizeCallback: ResizeObserverCallback;
const disconnect = vi.fn();
function sheet(side = "right", left = 640, footerTop = 720) {
  const node = document.createElement("div");
  node.dataset.slot = "sheet-content";
  node.dataset.side = side;
  node.setAttribute("data-open", "");
  node.getBoundingClientRect = () => rect(left) as DOMRect;
  const footer = document.createElement("div");
  footer.dataset.slot = "sheet-footer";
  footer.getBoundingClientRect = () => rect(left, footerTop) as DOMRect;
  node.append(footer);
  document.body.append(node);
  sheets.push(node);
  return node;
}
beforeEach(() => {
  sheets = [];
  disconnect.mockClear();
  vi.stubGlobal("innerWidth", 1200);
  vi.stubGlobal("innerHeight", 800);
  vi.stubGlobal("ResizeObserver", class {
    constructor(callback: ResizeObserverCallback) { resizeCallback = callback; }
    observe() {}
    disconnect = disconnect;
  });
});
afterEach(() => {
  cleanup();
  sheets.forEach((node) => node.remove());
  vi.unstubAllGlobals();
});

describe("sheet-aware toast placement", () => {
  it("ignores left sheets", () => {
    sheet("left");
    const { result } = renderHook(() => useToastPlacement());
    expect(result.current).toEqual({});
  });
  it("tracks opening and closing, restoring CSS defaults", async () => {
    const { result } = renderHook(() => useToastPlacement());
    expect(result.current).toEqual({});
    const node = sheet();
    await waitFor(() => expect(result.current).toEqual({ "--pf-toast-right": "572px" }));
    node.removeAttribute("data-open");
    node.setAttribute("data-closed", "");
    await waitFor(() => expect(result.current).toEqual({}));
  });
  it("uses only the topmost right sheet and returns to the underlying sheet", async () => {
    sheet();
    const top = sheet("right", 0);
    const { result } = renderHook(() => useToastPlacement());
    expect(result.current).toEqual({ "--pf-toast-bottom": "92px" });
    top.remove();
    await waitFor(() => expect(result.current).toEqual({ "--pf-toast-right": "572px" }));
  });
  it("recalculates on sheet/footer resize and window resize, and disconnects on unmount", () => {
    const node = sheet();
    const { result, unmount } = renderHook(() => useToastPlacement());
    node.getBoundingClientRect = () => rect(0) as DOMRect;
    act(() => resizeCallback([], {} as ResizeObserver));
    expect(result.current).toEqual({ "--pf-toast-bottom": "92px" });
    node.getBoundingClientRect = () => rect(640) as DOMRect;
    act(() => window.dispatchEvent(new Event("resize")));
    expect(result.current).toEqual({ "--pf-toast-right": "572px" });
    unmount();
    expect(disconnect).toHaveBeenCalled();
  });
});
