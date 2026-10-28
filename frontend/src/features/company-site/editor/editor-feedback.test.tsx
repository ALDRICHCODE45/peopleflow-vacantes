import { act, fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { SaveStatus } from "./editor-feedback";
import { createAutosave } from "../autosave";
import { useAutosave } from "../use-autosave";
import { defaultSiteDraft } from "../defaults";

it("offers retry for a generic error and saves the current draft successfully", async () => {
  const initial = { draft: defaultSiteDraft(), draft_version: 1, published: null, has_unpublished_changes: false, media: [], updated_at: "2026-10-27T00:00:00Z" };
  const save = vi.fn().mockResolvedValueOnce({ kind: "unrecognized" }).mockImplementation(async ({ body }) => ({ kind: "success", data: { ...initial, draft: body, draft_version: 2 }, etag: '\"2\"' }));
  const controller = createAutosave(initial, '\"1\"', save);
  controller.dispatch({ type: "slug", slug: "mi-empresa" });
  await controller.flush();
  function Status() {
    const { editor, status } = useAutosave(controller);
    return <SaveStatus status={status} dirty={editor.dirty} onLoadLatest={vi.fn()} onRetry={() => { void controller.retry(); }} />;
  }
  render(<Status />);
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Reintentar" })); });
  expect(save).toHaveBeenCalledTimes(2);
  expect(save.mock.calls[1][0].body.slug).toBe("mi-empresa");
  expect(screen.getByRole("status").textContent).toBe("Cambios guardados");
  expect(screen.queryByRole("button", { name: "Reintentar" })).toBeNull();
  await expect(controller.flush()).resolves.toEqual({ ok: true, version: 2 });
  controller.dispose();
});

it("announces an expired autosave session instead of a generic save error", () => {
  render(<SaveStatus status={{ kind: "error", failure: { kind: "unauthenticated" } }} dirty onLoadLatest={vi.fn()} />);
  expect(screen.getByRole("status").textContent).toBe("Tu sesión expiró. Inicia sesión para guardar los cambios.");
  expect(screen.queryByRole("button", { name: "Reintentar" })).toBeNull();
});
