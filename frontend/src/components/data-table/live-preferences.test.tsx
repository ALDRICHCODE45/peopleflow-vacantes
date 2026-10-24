import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it } from "vitest";
import { useTablePreferences } from "./use-table-preferences";

const defaults = { order: ["name", "city", "actions"], pinning: { start: [], end: ["actions"] }, fixedPinning: { start: [], end: ["actions"] }, nonHideable: ["actions"], visibility: {} };
beforeEach(() => localStorage.clear());
afterEach(cleanup);
it("keeps fixed actions rightmost live and after reload", () => {
  const first = renderHook(() => useTablePreferences("live", defaults));
  act(() => first.result.current.setPinning({ start: [], end: ["actions", "city"] }));
  expect(first.result.current.preferences.pinning.end).toEqual(["city", "actions"]);
  first.unmount();
  const second = renderHook(() => useTablePreferences("live", defaults));
  expect(second.result.current.preferences.pinning.end).toEqual(["city", "actions"]);
});
it("reconciles updater pinning so columns appear on only one side", () => {
  const { result } = renderHook(() => useTablePreferences("live", defaults));
  act(() => result.current.setPinning(previous => ({ ...previous, start: ["city", "actions"], end: ["actions", "city"] })));
  expect(result.current.preferences.pinning).toEqual({ start: ["city"], end: ["actions"] });
});
it("reconciles live order and visibility setters too", () => {
  const { result } = renderHook(() => useTablePreferences("live", defaults));
  act(() => result.current.setOrder(() => ["city", "city", "unknown"]));
  act(() => result.current.setVisibility(() => ({ actions: false, city: false, unknown: false })));
  expect(result.current.preferences.order).toEqual(["city", "name", "actions"]);
  expect(result.current.preferences.visibility).toEqual({ city: false });
});
