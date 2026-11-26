import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("./actions", () => ({ getUnreadCountAction: vi.fn() }));
import { getUnreadCountAction } from "./actions";
import { POLL_INTERVAL_MS, useUnreadCount } from "./use-unread-count";

const counter = (unread: number) => ({ ok: true as const, data: { unread_count: unread, unread_notifications: unread * 2 } });
let hidden = false;
beforeEach(() => {
  vi.useFakeTimers();
  vi.resetAllMocks();
  hidden = false;
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => (hidden ? "hidden" : "visible") });
});
afterEach(() => vi.useRealTimers());
const flush = () => act(async () => { await vi.advanceTimersByTimeAsync(0); });
const setHidden = (value: boolean) => act(() => { hidden = value; document.dispatchEvent(new Event("visibilitychange")); });

it("reads the counter on mount and again every 30 seconds", async () => {
  vi.mocked(getUnreadCountAction).mockResolvedValueOnce(counter(4)).mockResolvedValueOnce(counter(5));
  const { result } = renderHook(() => useUnreadCount());
  expect(result.current.unread).toBeNull();
  await flush();
  expect(result.current.unread).toBe(4);
  await act(async () => { await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS); });
  expect(result.current.unread).toBe(5);
  expect(getUnreadCountAction).toHaveBeenCalledTimes(2);
  expect(POLL_INTERVAL_MS).toBe(30_000);
});

it("stops polling while the tab is hidden and refreshes as soon as it is visible again", async () => {
  vi.mocked(getUnreadCountAction).mockResolvedValue(counter(1));
  renderHook(() => useUnreadCount());
  await flush();
  setHidden(true);
  await act(async () => { await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 3); });
  expect(getUnreadCountAction).toHaveBeenCalledTimes(1);
  vi.mocked(getUnreadCountAction).mockResolvedValue(counter(7));
  setHidden(false);
  await flush();
  expect(getUnreadCountAction).toHaveBeenCalledTimes(2);
});

it("keeps the last known count when a poll fails", async () => {
  vi.mocked(getUnreadCountAction).mockResolvedValueOnce(counter(3)).mockResolvedValueOnce({ ok: false, reason: "no_response", reference: {} });
  const { result } = renderHook(() => useUnreadCount());
  await flush();
  await act(async () => { await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS); });
  expect(result.current.unread).toBe(3);
});

it("gives up polling once the session is no longer allowed", async () => {
  vi.mocked(getUnreadCountAction).mockResolvedValue({ ok: false, reason: "unauthenticated", reference: { status: 401 } });
  renderHook(() => useUnreadCount());
  await flush();
  await act(async () => { await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 2); });
  expect(getUnreadCountAction).toHaveBeenCalledTimes(1);
});

it("lets the inbox push a fresher count without waiting for the next poll", async () => {
  vi.mocked(getUnreadCountAction).mockResolvedValue(counter(4));
  const { result } = renderHook(() => useUnreadCount());
  await flush();
  act(() => result.current.set(2));
  expect(result.current.unread).toBe(2);
  vi.mocked(getUnreadCountAction).mockResolvedValue(counter(9));
  await act(async () => { await result.current.refresh(); });
  expect(result.current.unread).toBe(9);
});
