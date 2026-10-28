import { act, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { createAutosave } from "./autosave";
import { useAutosave } from "./use-autosave";
import { defaultSiteDraft } from "./defaults";
afterEach(() => vi.useRealTimers());
it("exposes the controller's shared awaitable flush through the hook", async () => {
  const initial = { draft: defaultSiteDraft(), draft_version: 1, published: null, has_unpublished_changes: false, media: [], updated_at: "2026-10-27T00:00:00Z" };
  const save = vi.fn().mockImplementation(async ({ body }) => ({ kind: "success", data: { ...initial, draft: body, draft_version: 2 }, etag: '"2"' }));
  const controller = createAutosave(initial, '"1"', save);
  const { result, unmount } = renderHook(() => useAutosave(controller));
  act(() => controller.dispatch({ type: "slug", slug: "latest" }));
  await act(async () => {
    const flushing = result.current.flush(); expect(controller.flush()).toBe(flushing);
    await expect(flushing).resolves.toEqual({ ok: true, version: 2 });
  });
  expect(result.current.editor.dirty).toBe(false); expect(save).toHaveBeenCalledOnce();
  unmount(); controller.dispose();
});
it("subscribes to controller changes and attaches/detaches online handling", async () => {
  vi.useFakeTimers();
  const initial = { draft: defaultSiteDraft(), draft_version: 1, published: null, has_unpublished_changes: false, media: [], updated_at: "2026-10-27T00:00:00Z" };
  const save = vi.fn().mockResolvedValue({ kind: "uncertain" }); const controller = createAutosave(initial, '"1"', save);
  const { result, unmount } = renderHook(() => useAutosave(controller));
  act(() => controller.dispatch({ type: "slug", slug: "nexo" })); expect(result.current.editor.draft.slug).toBe("nexo");
  await act(() => vi.advanceTimersByTimeAsync(1500)); expect(result.current.status.kind).toBe("offline");
  await act(async () => { window.dispatchEvent(new Event("online")); }); expect(save).toHaveBeenCalledTimes(2);
  unmount(); window.dispatchEvent(new Event("online")); expect(save).toHaveBeenCalledTimes(2); controller.dispose();
});
