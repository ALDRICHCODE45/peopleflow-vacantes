import { act, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { createAutosave } from "./autosave";
import { useAutosave } from "./use-autosave";
import { defaultSiteDraft } from "./defaults";
afterEach(() => vi.useRealTimers());
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
