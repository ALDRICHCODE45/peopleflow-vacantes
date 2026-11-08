import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MetricsResult } from "./model";
import { useSection } from "./use-section";

type Observer = { callback: IntersectionObserverCallback; options?: IntersectionObserverInit; disconnect: ReturnType<typeof vi.fn> };
let observers: Observer[] = [];
beforeEach(() => {
  observers = [];
  vi.stubGlobal("IntersectionObserver", class {
    disconnect = vi.fn();
    constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) { observers.push({ callback, options, disconnect: this.disconnect }); }
    observe() {}
    unobserve() {}
  });
});
afterEach(() => vi.unstubAllGlobals());

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
};
const ok = (value: number): MetricsResult<number> => ({ ok: true, data: value });

describe("useSection (rule 17: each section loads on its own)", () => {
  it("loads an eager section at once and answers ready with its data", async () => {
    const load = vi.fn(async () => ok(1));
    const { result } = renderHook(() => useSection(load, { from: "2026-08-01" }, "a"));
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.data).toBe(1);
    expect(load).toHaveBeenCalledWith({ from: "2026-08-01" });
  });

  it("waits until a lazy section approaches the viewport", async () => {
    const load = vi.fn(async () => ok(2));
    const { result } = renderHook(() => useSection(load, {}, "a", { lazy: true }));
    act(() => result.current.ref(document.createElement("div")));
    expect(result.current.status).toBe("idle");
    expect(load).not.toHaveBeenCalled();
    expect(observers[0].options?.rootMargin).toBe("600px 0px");
    act(() => observers[0].callback([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver));
    await waitFor(() => expect(result.current.data).toBe(2));
    expect(observers[0].disconnect).toHaveBeenCalled();
  });

  it("keeps the old numbers, marked stale, until the new period arrives, and ignores a late older answer", async () => {
    const first = deferred<MetricsResult<number>>();
    const second = deferred<MetricsResult<number>>();
    const load = vi.fn().mockResolvedValueOnce(ok(1)).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const { result, rerender } = renderHook(({ key }) => useSection(load, { recruiter_id: key }, key), { initialProps: { key: "a" } });
    await waitFor(() => expect(result.current.data).toBe(1));
    rerender({ key: "b" });
    expect(result.current).toMatchObject({ status: "loading", data: 1, stale: true });
    rerender({ key: "c" });
    await act(async () => { second.resolve(ok(3)); });
    await act(async () => { first.resolve(ok(2)); });
    expect(result.current).toMatchObject({ status: "ready", data: 3, stale: false });
  });

  it("answers failed with the failure and loads again on retry", async () => {
    const load = vi.fn().mockResolvedValueOnce({ ok: false, reason: "server_error", reference: { status: 500 } }).mockResolvedValueOnce(ok(4));
    const { result } = renderHook(() => useSection(load, {}, "a"));
    await waitFor(() => expect(result.current.status).toBe("failed"));
    expect(result.current.failure?.reason).toBe("server_error");
    act(() => result.current.retry());
    await waitFor(() => expect(result.current.data).toBe(4));
  });

  it("treats a thrown action as no response", async () => {
    const { result } = renderHook(() => useSection(vi.fn().mockRejectedValue(new Error("network")), {}, "a"));
    await waitFor(() => expect(result.current.failure?.reason).toBe("no_response"));
  });
});
