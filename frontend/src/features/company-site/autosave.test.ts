import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createAutosave, autosaveLabel } from "./autosave";
import { defaultSiteDraft } from "./defaults";
import type { SiteResult, SiteState } from "./api/model";
const data = (): SiteState => ({ draft: defaultSiteDraft(), draft_version: 1, published: null, has_unpublished_changes: false, media: [], updated_at: "2026-10-27T00:00:00Z" });
const deferred = () => { let resolve!: (result: SiteResult) => void; const promise = new Promise<SiteResult>(r => { resolve = r; }); return { promise, resolve }; };
beforeEach(() => vi.useFakeTimers()); afterEach(() => vi.useRealTimers());
it("explicit retry saves the current draft even after reverting an unrecognized write", async () => {
  const initial = data();
  const save = vi.fn().mockResolvedValueOnce({ kind: "unrecognized" }).mockImplementation(async ({ body }) => ({ kind: "success", data: { ...initial, draft: body, draft_version: 2 }, etag: '\"2\"' }));
  const c = createAutosave(initial, '\"1\"', save);
  c.dispatch({ type: "slug", slug: "changed" });
  await c.flush();
  c.dispatch({ type: "slug", slug: initial.draft.slug });
  await expect(c.retry()).resolves.toEqual({ ok: true, version: 2 });
  expect(save).toHaveBeenCalledTimes(2);
  expect(save.mock.calls[1][0].body).toEqual(initial.draft);
  c.dispose();
});
it("reverting an invalid edit to the saved draft clears the invalid status without saving", async () => {
  const initial = data();
  const save = vi.fn().mockResolvedValueOnce({ kind: "invalid", fields: [{ field: "slug", code: "too_long" }] });
  const c = createAutosave(initial, '"1"', save);
  c.dispatch({ type: "slug", slug: "changed" });
  await c.flush();
  expect(c.getSnapshot().status.kind).toBe("invalid");
  c.dispatch({ type: "slug", slug: initial.draft.slug });
  expect(c.getSnapshot().status.kind).toBe("idle");
  expect(c.getSnapshot().editor.fieldErrors).toEqual([]);
  await expect(c.flush()).resolves.toEqual({ ok: true, version: 1 });
  await vi.advanceTimersByTimeAsync(10000);
  expect(save).toHaveBeenCalledTimes(1);
  c.dispose();
});
it("flush shares a promise, waits for in-flight and queued edits, and cancels the debounce", async () => {
  const initial = data(); const pending = deferred();
  const save = vi.fn().mockReturnValueOnce(pending.promise).mockImplementation(async ({ body }) => ({ kind: "success", data: { ...initial, draft: body, draft_version: 3 }, etag: '"3"' }));
  const c = createAutosave(initial, '"1"', save);
  c.dispatch({ type: "slug", slug: "first" }); await vi.advanceTimersByTimeAsync(1500);
  const first = c.flush(); expect(c.flush()).toBe(first);
  c.dispatch({ type: "slug", slug: "latest" });
  pending.resolve({ kind: "success", data: { ...initial, draft: { ...initial.draft, slug: "first" }, draft_version: 2 }, etag: '"2"' });
  await expect(first).resolves.toEqual({ ok: true, version: 3 });
  expect(save).toHaveBeenCalledTimes(2); expect(save.mock.calls[1][0]).toMatchObject({ body: { slug: "latest" }, ifMatch: '"2"' });
  await vi.advanceTimersByTimeAsync(10000); expect(save).toHaveBeenCalledTimes(2); c.dispose();
});
it.each([
  [{ kind: "uncertain" }, "offline"], [{ kind: "unauthenticated" }, "unauthenticated"],
  [{ kind: "invalid", fields: [] }, "invalid"], [{ kind: "unrecognized" }, "error"],
  [{ kind: "conflict", current: data() }, "conflict"],
] as const)("flush reports terminal %s without retrying", async (failure, reason) => {
  const save = vi.fn().mockResolvedValue(failure); const c = createAutosave(data(), '"1"', save);
  c.dispatch({ type: "slug", slug: "local" });
  await expect(c.flush()).resolves.toEqual({ ok: false, reason });
  await expect(c.flush()).resolves.toEqual({ ok: false, reason });
  await vi.advanceTimersByTimeAsync(10000); expect(save).toHaveBeenCalledOnce(); c.dispose();
});
it("includes edits from completion subscribers before resolving flush", async () => {
  const initial = data(); const save = vi.fn().mockImplementation(async ({ body }) => ({ kind: "success", data: { ...initial, draft: body, draft_version: body.slug === "latest" ? 3 : 2 }, etag: body.slug === "latest" ? '"3"' : '"2"' }));
  const c = createAutosave(initial, '"1"', save); c.dispatch({ type: "slug", slug: "first" });
  const detach = c.subscribe(() => { if (c.getSnapshot().status.kind === "saved" && c.getSnapshot().editor.draft.slug === "first") c.dispatch({ type: "slug", slug: "latest" }); });
  await expect(c.flush()).resolves.toEqual({ ok: true, version: 3 });
  expect(c.getSnapshot().editor.dirty).toBe(false); expect(save).toHaveBeenCalledTimes(2); detach(); c.dispose();
});
it("settles waiting flush on disposal without performing queued writes", async () => {
  const pending = deferred(); const save = vi.fn().mockReturnValue(pending.promise); const c = createAutosave(data(), '"1"', save);
  c.dispatch({ type: "slug", slug: "first" }); const result = c.flush();
  c.dispatch({ type: "slug", slug: "later" }); c.dispose();
  await expect(result).resolves.toEqual({ ok: false, reason: "error" });
  pending.resolve({ kind: "uncertain" }); await vi.advanceTimersByTimeAsync(10000); expect(save).toHaveBeenCalledOnce();
});
it.each(["autosave", "explicit flush"])("every flush after disposal settles while the %s PUT is still pending", async source => {
  const pending = deferred(); const save = vi.fn().mockReturnValue(pending.promise);
  const c = createAutosave(data(), '"1"', save); c.attachOnline(window);
  c.dispatch({ type: "slug", slug: "first" });
  const prior = source === "explicit flush" ? c.flush() : undefined;
  if (!prior) await vi.advanceTimersByTimeAsync(1500);
  expect(save).toHaveBeenCalledOnce(); c.dispose();
  if (prior) await expect(prior).resolves.toEqual({ ok: false, reason: "error" });
  // Observe a bounded microtask turn instead of letting a hanging promise consume
  // the test timeout. The PUT intentionally remains unresolved for both calls.
  for (let call = 0; call < 2; call += 1) {
    const settled = vi.fn(); void c.flush().then(settled);
    await Promise.resolve(); await Promise.resolve();
    expect(settled).toHaveBeenCalledExactlyOnceWith({ ok: false, reason: "error" });
  }
  c.dispatch({ type: "slug", slug: "after-dispose" }); window.dispatchEvent(new Event("online"));
  pending.resolve({ kind: "success", data: data(), etag: '"1"' });
  await vi.advanceTimersByTimeAsync(10000); expect(save).toHaveBeenCalledOnce();
});
it.each([["slug_taken", "duplicate"], ["slug_reserved", "not_allowed"]] as const)("maps save %s to an invalid slug field instead of a global error", async (code, fieldCode) => {
  const save = vi.fn().mockResolvedValue({ kind: "error", code, field: "slug" }); const c = createAutosave(data(), '"1"', save);
  c.dispatch({ type: "slug", slug: "candidate" });
  await expect(c.flush()).resolves.toEqual({ ok: false, reason: "invalid" });
  expect(c.getSnapshot().status.kind).toBe("invalid");
  expect(c.getSnapshot().editor.fieldErrors).toEqual([{ field: "slug", code: fieldCode }]);
  expect(autosaveLabel(c.getSnapshot().status)).toBe("Revisa los campos marcados");
  await vi.advanceTimersByTimeAsync(10000); expect(save).toHaveBeenCalledOnce(); c.dispose();
});
it("flush saves pending edits immediately and clean flush performs no request", async () => {
  const initial = data(); const save = vi.fn().mockImplementation(async ({ body }) => ({ kind: "success", data: { ...initial, draft: body, draft_version: 2 }, etag: '"2"' }));
  const c = createAutosave(initial, '"1"', save);
  await expect(c.flush()).resolves.toEqual({ ok: true, version: 1 }); expect(save).not.toHaveBeenCalled();
  c.dispatch({ type: "slug", slug: "local" }); await expect(c.flush()).resolves.toEqual({ ok: true, version: 2 });
  expect(save).toHaveBeenCalledOnce(); c.dispose();
});
it("debounces edits into one save with the current If-Match", async () => {
  const initial = data(); const save = vi.fn().mockResolvedValue({ kind: "success", data: initial, etag: '"1"' }); const c = createAutosave(initial, '"1"', save);
  c.dispatch({ type: "slug", slug: "first" }); await vi.advanceTimersByTimeAsync(1000); c.dispatch({ type: "slug", slug: "second" });
  await vi.advanceTimersByTimeAsync(1499); expect(save).not.toHaveBeenCalled(); await vi.advanceTimersByTimeAsync(1);
  expect(save).toHaveBeenCalledOnce(); expect(save).toHaveBeenCalledWith({ body: expect.objectContaining({ slug: "second" }), ifMatch: '"1"' }); c.dispose();
});
it("never overlaps saves, retains in-flight edits and queues the latest with the new version", async () => {
  const initial = data(); const pending = deferred(); const save = vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValue({ kind: "success", data: { ...initial, draft: { ...initial.draft, slug: "last" }, draft_version: 3 }, etag: '"3"' });
  const c = createAutosave(initial, '"1"', save); c.dispatch({ type: "slug", slug: "first" }); await vi.advanceTimersByTimeAsync(1500);
  c.dispatch({ type: "slug", slug: "middle" }); c.dispatch({ type: "slug", slug: "last" }); await vi.advanceTimersByTimeAsync(2000); expect(save).toHaveBeenCalledOnce();
  pending.resolve({ kind: "success", data: { ...initial, draft: { ...initial.draft, slug: "first" }, draft_version: 2 }, etag: '"2"' }); await vi.advanceTimersByTimeAsync(0);
  expect(save).toHaveBeenCalledTimes(2); expect(save.mock.calls[1][0]).toMatchObject({ body: { slug: "last" }, ifMatch: '"2"' });
  expect(c.getSnapshot().editor.draft.slug).toBe("last"); expect(c.getSnapshot().editor.dirty).toBe(false); c.dispose();
});
it("412 retains local edits, exposes current, blocks edits/online autosave until explicit resolution", async () => {
  const initial = data(); const current = { ...initial, draft_version: 4 }; const save = vi.fn().mockResolvedValue({ kind: "conflict", current }); const c = createAutosave(initial, '"1"', save); const detach = c.attachOnline(window);
  c.dispatch({ type: "slug", slug: "local" }); await vi.advanceTimersByTimeAsync(1500);
  expect(c.getSnapshot().status).toEqual({ kind: "conflict", current }); expect(c.getSnapshot().editor.draft.slug).toBe("local");
  c.dispatch({ type: "slug", slug: "new-local" }); window.dispatchEvent(new Event("online")); await vi.advanceTimersByTimeAsync(10000); expect(save).toHaveBeenCalledOnce();
  c.resolveConflict(current, '"4"', "keep-local"); await vi.advanceTimersByTimeAsync(1500); expect(save).toHaveBeenCalledTimes(2); detach(); c.dispose();
});
it("400 uses indices from the submitted snapshot even after reorder, and resumes on next edit", async () => {
  const initial = data(); const pending = deferred(); const save = vi.fn().mockReturnValue(pending.promise); const c = createAutosave(initial, '"1"', save);
  c.dispatch({ type: "slug", slug: "local" }); await vi.advanceTimersByTimeAsync(1500); const id = initial.draft.blocks[0].id;
  c.dispatch({ type: "move", id, direction: 1 }); pending.resolve({ kind: "invalid", fields: [{ field: "blocks[0].content.title", code: "too_long" }] }); await vi.advanceTimersByTimeAsync(0);
  expect(c.getSnapshot().editor.fieldErrors[0]).toMatchObject({ blockId: id, field: "content.title" }); expect(c.getSnapshot().status.kind).toBe("invalid");
  await vi.advanceTimersByTimeAsync(10000); expect(save).toHaveBeenCalledOnce(); c.dispatch({ type: "slug", slug: "fixed" }); await vi.advanceTimersByTimeAsync(1500); expect(save).toHaveBeenCalledTimes(2); c.dispose();
});
it.each(["online", "edit"])("uncertain has no timer retries and resumes only on %s", async trigger => {
  const initial = data(); const save = vi.fn().mockResolvedValue({ kind: "uncertain" }); const c = createAutosave(initial, '"1"', save); const detach = c.attachOnline(window);
  c.dispatch({ type: "slug", slug: "local" }); await vi.advanceTimersByTimeAsync(1500); expect(c.getSnapshot().status.kind).toBe("offline");
  await vi.advanceTimersByTimeAsync(60000); expect(save).toHaveBeenCalledOnce();
  if (trigger === "online") window.dispatchEvent(new Event("online")); else c.dispatch({ type: "slug", slug: "next" });
  await vi.advanceTimersByTimeAsync(1500); expect(save).toHaveBeenCalledTimes(2); detach(); c.dispose();
});
it("after an uncertain save, reverting to the last confirmed document still saves it (the server may hold the unconfirmed one)", async () => {
  const initial = data(); const save = vi.fn().mockResolvedValueOnce({ kind: "uncertain" }).mockResolvedValue({ kind: "success", data: initial, etag: '"1"' });
  const c = createAutosave(initial, '"1"', save);
  c.dispatch({ type: "slug", slug: "maybe-saved" }); await vi.advanceTimersByTimeAsync(1500); expect(c.getSnapshot().status.kind).toBe("offline");
  // Back to exactly the last confirmed document: locally clean, but its server copy is unknown.
  c.dispatch({ type: "slug", slug: initial.draft.slug }); await vi.advanceTimersByTimeAsync(1500);
  expect(save).toHaveBeenCalledTimes(2);
  expect(save.mock.calls[1][0].body.slug).toBe(initial.draft.slug);
  expect(c.getSnapshot().status.kind).toBe("saved"); c.dispose();
});
it("reverting to the old saved document during a request still saves the revert after its 200", async () => {
  const initial = data(); const pending = deferred(); const save = vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValue({ kind: "success", data: { ...initial, draft_version: 3 }, etag: '\"3\"' });
  const c = createAutosave(initial, '\"1\"', save); c.dispatch({ type: "slug", slug: "temporary" }); await vi.advanceTimersByTimeAsync(1500);
  c.dispatch({ type: "slug", slug: null }); await vi.advanceTimersByTimeAsync(1500);
  pending.resolve({ kind: "success", data: { ...initial, draft: { ...initial.draft, slug: "temporary" }, draft_version: 2 }, etag: '\"2\"' }); await vi.advanceTimersByTimeAsync(0);
  expect(save).toHaveBeenCalledTimes(2); expect(save.mock.calls[1][0]).toMatchObject({ body: { slug: null }, ifMatch: '\"2\"' }); c.dispose();
});
it("200 updates saved snapshot without clobbering a newer edit still in debounce", async () => {
  const initial = data(); const pending = deferred(); const save = vi.fn().mockReturnValue(pending.promise); const c = createAutosave(initial, '\"1\"', save);
  c.dispatch({ type: "slug", slug: "submitted" }); await vi.advanceTimersByTimeAsync(1500); c.dispatch({ type: "slug", slug: "newer" });
  pending.resolve({ kind: "success", data: { ...initial, draft: { ...initial.draft, slug: "submitted" }, draft_version: 2 }, etag: '\"2\"' }); await vi.advanceTimersByTimeAsync(0);
  expect(c.getSnapshot().editor).toMatchObject({ draft: { slug: "newer" }, lastSaved: { slug: "submitted" }, draft_version: 2, etag: '\"2\"', dirty: true }); expect(save).toHaveBeenCalledOnce(); c.dispose();
});
it("explicit use-server resolution discards only on user choice", async () => {
  const initial = data(); const save = vi.fn().mockResolvedValue({ kind: "conflict", current: initial }); const c = createAutosave(initial, '\"1\"', save);
  c.dispatch({ type: "slug", slug: "local" }); await vi.advanceTimersByTimeAsync(1500); c.resolveConflict(initial, '\"1\"', "use-server");
  expect(c.getSnapshot().editor.draft.slug).toBe(null); expect(c.getSnapshot().editor.dirty).toBe(false); await vi.advanceTimersByTimeAsync(10000); expect(save).toHaveBeenCalledOnce(); c.dispose();
});
it("unrecognized/error outcomes do not retry and disposal cancels pending work", async () => {
  const initial = data(); const save = vi.fn().mockResolvedValue({ kind: "unrecognized" }); const c = createAutosave(initial, '\"1\"', save);
  c.dispatch({ type: "slug", slug: "local" }); await vi.advanceTimersByTimeAsync(1500); expect(c.getSnapshot().status.kind).toBe("error");
  await vi.advanceTimersByTimeAsync(10000); expect(save).toHaveBeenCalledOnce(); c.dispatch({ type: "slug", slug: "later" }); c.dispose(); await vi.advanceTimersByTimeAsync(10000); expect(save).toHaveBeenCalledOnce();
});
it("keeps local edits and announces a session problem without retrying an expired session", async () => {
  const save = vi.fn().mockResolvedValue({ kind: "unauthenticated" });
  const c = createAutosave(data(), '\"1\"', save);
  const detach = c.attachOnline(window);
  c.dispatch({ type: "slug", slug: "local" });
  await vi.advanceTimersByTimeAsync(1500);
  expect(c.getSnapshot().editor).toMatchObject({ dirty: true, draft: { slug: "local" } });
  expect(c.getSnapshot().status).toEqual({ kind: "error", failure: { kind: "unauthenticated" } });
  expect(autosaveLabel(c.getSnapshot().status)).toBe("Tu sesión expiró. Inicia sesión para guardar los cambios.");
  window.dispatchEvent(new Event("online"));
  await vi.advanceTimersByTimeAsync(60000);
  expect(save).toHaveBeenCalledOnce();
  detach(); c.dispose();
});
it("reports saved time, no-op versions, error and exact Spanish labels", async () => {
  const initial = data(); const save = vi.fn().mockImplementation(async ({ body }) => ({ kind: "success", data: { ...initial, draft: body }, etag: '"1"' })); const c = createAutosave(initial, '"1"', save);
  c.dispatch({ type: "slug", slug: "local" }); await vi.advanceTimersByTimeAsync(1500); expect(c.getSnapshot().status).toEqual({ kind: "saved", at: expect.any(Number) }); expect(c.getSnapshot().editor.draft_version).toBe(1);
  expect(autosaveLabel({ kind: "saving" })).toBe("Guardando…"); expect(autosaveLabel({ kind: "saved", at: 0 }, 120000)).toBe("Guardado hace 2 min"); expect(autosaveLabel({ kind: "offline" })).toBe("Sin conexión · tus cambios se guardarán al reconectar"); expect(autosaveLabel({ kind: "conflict", current: initial })).toBe("Alguien más editó este sitio");
  save.mockRejectedValueOnce(new Error("offline")); c.dispatch({ type: "slug", slug: "again" }); await vi.advanceTimersByTimeAsync(1500); expect(c.getSnapshot().status.kind).toBe("offline"); c.dispose();
});
