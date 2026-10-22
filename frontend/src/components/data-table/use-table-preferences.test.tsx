import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useTablePreferences } from "./use-table-preferences";

const defaults = { order: ["name", "city", "actions"], pinning: { start: ["name"], end: ["actions"] }, visibility: {} };
beforeEach(() => localStorage.clear());
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
it("uses defaults and round trips order, pinning and visibility", async () => {
  const first = renderHook(() => useTablePreferences("test", defaults));
  expect(first.result.current.preferences).toEqual({ v: 1, ...defaults });
  act(() => first.result.current.setOrder(["city", "name", "actions"]));
  act(() => first.result.current.setPinning({ start: ["city"], end: ["actions"] }));
  act(() => first.result.current.setVisibility({ name: false }));
  await waitFor(() => expect(JSON.parse(localStorage.getItem("pf.table.test")!)).toEqual(first.result.current.preferences));
  const saved = first.result.current.preferences;
  first.unmount();
  const second = renderHook(() => useTablePreferences("test", defaults));
  expect(second.result.current.preferences).toEqual(saved);
});
it("drops unknown/duplicate ids and appends new columns without pinning twice", () => {
  localStorage.setItem("pf.table.test", JSON.stringify({ v: 1, order: ["city", "gone", "city"], pinning: { start: ["gone", "city"], end: ["city", "actions"] }, visibility: { gone: false, city: false } }));
  const { result } = renderHook(() => useTablePreferences("test", defaults));
  expect(result.current.preferences).toEqual({ v: 1, order: ["city", "name", "actions"], pinning: { start: ["city"], end: ["actions"] }, visibility: { city: false } });
});
it.each(["{", JSON.stringify({ v: 2, ...defaults }), JSON.stringify({ v: 1, ...defaults, visibility: { city: "no" } })])("ignores corrupt or incompatible preferences: %s", stored => {
  localStorage.setItem("pf.table.test", stored);
  expect(renderHook(() => useTablePreferences("test", defaults)).result.current.preferences).toEqual({ v: 1, ...defaults });
});
it("resets all preferences and persists defaults", () => {
  const { result } = renderHook(() => useTablePreferences("test", defaults));
  act(() => result.current.setVisibility({ city: false }));
  act(() => result.current.reset());
  expect(result.current.preferences).toEqual({ v: 1, ...defaults });
  expect(JSON.parse(localStorage.getItem("pf.table.test")!)).toEqual({ v: 1, ...defaults });
});
it("does not throw when storage reads or writes are denied", () => {
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("denied"); });
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("quota"); });
  const { result } = renderHook(() => useTablePreferences("test", defaults));
  expect(() => act(() => result.current.setVisibility({ city: false }))).not.toThrow();
  expect(() => act(() => result.current.reset())).not.toThrow();
});
