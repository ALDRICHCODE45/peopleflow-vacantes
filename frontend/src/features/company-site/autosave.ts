import type { SaveInput } from "./api/client";
import type { Failure, SiteResult, SiteState } from "./api/model";
import { createEditorState, editorReducer, sameDraft, type EditorAction, type EditorState } from "./editor-state";

export type AutosaveStatus =
  | { kind: "idle" | "saving" | "offline" | "invalid" }
  | { kind: "saved"; at: number }
  | { kind: "conflict"; current: SiteState }
  | { kind: "error"; failure: Failure };
export type AutosaveSnapshot = { editor: EditorState; status: AutosaveStatus };
export type EditAction = Exclude<EditorAction, { type: "load" | "saved" | "invalid" }>;
export type SaveDraft = (input: SaveInput) => Promise<SiteResult>;
export type FlushResult = { ok: true; version: number } | { ok: false; reason: "conflict" | "offline" | "invalid" | "error" | "unauthenticated" };

/** One controller per editor session; its owner calls dispose when leaving the editor. */
export function createAutosave(initial: SiteState, etag: string, save: SaveDraft, debounceMs = 1500) {
  let snapshot: AutosaveSnapshot = { editor: createEditorState(initial, etag), status: { kind: "idle" } };
  let timer: ReturnType<typeof setTimeout> | undefined;
  let inFlight = false; let due = false; let disposed = false;
  // After an uncertain save the server may hold the unconfirmed document, so a
  // draft equal to lastSaved is not proof that nothing needs saving.
  let unconfirmed = false;
  let flushPromise: Promise<FlushResult> | undefined;
  let finishFlush: ((result: FlushResult) => void) | undefined;
  function failure(): FlushResult | undefined {
    const status = snapshot.status;
    if (disposed) return { ok: false, reason: "error" };
    if (status.kind === "error") return { ok: false, reason: status.failure.kind === "unauthenticated" ? "unauthenticated" : "error" };
    if (status.kind === "conflict" || status.kind === "offline" || status.kind === "invalid") return { ok: false, reason: status.kind };
  }
  function settleFlush(result: FlushResult) { finishFlush?.(result); finishFlush = undefined; }
  function flushLatest(): Promise<FlushResult> {
    if (flushPromise) return flushPromise;
    // Terminal failures are never silently replayed by publication. An edit or
    // online event must first schedule a fresh autosave attempt.
    const terminal = failure();
    flushPromise = new Promise<FlushResult>(resolve => { finishFlush = resolve; });
    const promise = flushPromise;
    void promise.then(() => { if (flushPromise === promise) flushPromise = undefined; });
    if (disposed || (terminal && !timer && !inFlight)) settleFlush(terminal ?? { ok: false, reason: "error" });
    else if (!inFlight && !snapshot.editor.dirty && !unconfirmed) settleFlush({ ok: true, version: snapshot.editor.draft_version });
    else { cancelPending(); void flush(); }
    return promise;
  }
  const listeners = new Set<() => void>();
  const onlineCleanups = new Set<() => void>();
  const emit = (editor: EditorState, status: AutosaveStatus) => {
    snapshot = { editor, status }; listeners.forEach(listener => listener());
  };
  function cancelPending() { clearTimeout(timer); timer = undefined; due = false; }
  function schedule() {
    clearTimeout(timer); due = false;
    timer = setTimeout(() => { timer = undefined; void flush(); }, debounceMs);
  }
  async function flush() {
    if (disposed || snapshot.status.kind === "conflict") return;
    // Even a revert that matches lastSaved must wait for the in-flight write:
    // its response may change the baseline and make that revert dirty again.
    if (inFlight) { due = true; return; }
    if (!snapshot.editor.dirty && !unconfirmed) return;
    inFlight = true; due = false;
    const submitted = structuredClone(snapshot.editor.draft);
    const ifMatch = snapshot.editor.etag;
    emit(snapshot.editor, { kind: "saving" });
    let result: SiteResult;
    try { result = await save({ body: submitted, ifMatch }); }
    catch { result = { kind: "uncertain" }; }
    inFlight = false;
    if (disposed) return;
    unconfirmed = result.kind === "uncertain";
    if (result.kind === "success") {
      const editor = editorReducer(snapshot.editor, { type: "saved", data: result.data, etag: result.etag, submitted });
      emit(editor, { kind: "saved", at: Date.now() });
      // Subscribers may synchronously edit in response to this completion. The
      // live snapshot, not the pre-notification reducer value, owns the barrier.
      if (!snapshot.editor.dirty) {
        cancelPending();
        settleFlush({ ok: true, version: snapshot.editor.draft_version });
      } else if (due || finishFlush) { cancelPending(); void flush(); }
      // If the last edit is still debouncing, leave its timer in place.
      return;
    }
    // Failure is terminal for this attempt, including edits queued during it.
    // Only a subsequent edit/online event (offline only) starts another attempt.
    cancelPending();
    if (result.kind === "conflict") emit(snapshot.editor, { kind: "conflict", current: result.current });
    else if (result.kind === "invalid") emit(editorReducer(snapshot.editor, { type: "invalid", fields: result.fields, submitted }), { kind: "invalid" });
    else if (result.kind === "error" && (result.code === "slug_taken" || result.code === "slug_reserved")) {
      emit(editorReducer(snapshot.editor, { type: "invalid", fields: [{ field: "slug", code: result.code === "slug_taken" ? "duplicate" : "not_allowed" }], submitted }), { kind: "invalid" });
    }
    else if (result.kind === "uncertain") emit(snapshot.editor, { kind: "offline" });
    else emit(snapshot.editor, { kind: "error", failure: result });
    settleFlush(failure() ?? { ok: false, reason: "error" });
  }
  return {
    flush: flushLatest,
    /** Explicit retry never bypasses authentication or conflict resolution. */
    retry() {
      if (disposed || snapshot.status.kind !== "error" || snapshot.status.failure.kind === "unauthenticated") return flushLatest();
      // The failed response may hide a completed write. Retry the current
      // document even if the user reverted to the last confirmed baseline.
      unconfirmed = true;
      emit(snapshot.editor, { kind: "idle" });
      return flushLatest();
    },
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    dispatch(action: EditAction) {
      if (disposed) return;
      const before = snapshot.editor;
      const editor = editorReducer(before, action);
      const edited = !sameDraft(before.draft, editor.draft);
      // Returning to the confirmed saved draft leaves nothing to fix or save.
      const settled = edited && !editor.dirty && !inFlight && !unconfirmed && snapshot.status.kind === "invalid";
      emit(editor, settled ? { kind: "idle" } : snapshot.status);
      if (!edited || snapshot.status.kind === "conflict") return;
      if (!editor.dirty && !inFlight && !unconfirmed) cancelPending(); else schedule();
    },
    attachOnline(target: Pick<EventTarget, "addEventListener" | "removeEventListener">) {
      const online = () => { if (snapshot.status.kind === "offline") void flush(); };
      target.addEventListener("online", online);
      const cleanup = () => { target.removeEventListener("online", online); onlineCleanups.delete(cleanup); };
      onlineCleanups.add(cleanup); return cleanup;
    },
    /** Explicit user choice only: either discard local edits or rebase their full document on current. No merge. */
    resolveConflict(current: SiteState, currentEtag: string, choice: "use-server" | "keep-local") {
      if (disposed || snapshot.status.kind !== "conflict") return;
      const local = snapshot.editor.draft;
      let editor = createEditorState(current, currentEtag);
      if (choice === "keep-local") editor = { ...editor, draft: local, dirty: !sameDraft(local, editor.lastSaved) };
      emit(editor, { kind: "idle" });
      if (editor.dirty) schedule();
    },
    dispose() { disposed = true; cancelPending(); settleFlush({ ok: false, reason: "error" }); onlineCleanups.forEach(cleanup => cleanup()); listeners.clear(); },
  };
}
export type AutosaveController = ReturnType<typeof createAutosave>;

export function relativeSavedTime(at: number, now = Date.now()): string {
  const minutes = Math.max(0, Math.floor((now - at) / 60000));
  if (minutes === 0) return "Guardado hace un momento";
  if (minutes < 60) return `Guardado hace ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return `Guardado hace ${hours} h`;
}
export function autosaveLabel(status: AutosaveStatus, now = Date.now()): string {
  switch (status.kind) {
    case "saving": return "Guardando…";
    case "saved": return relativeSavedTime(status.at, now);
    case "offline": return "Sin conexión · tus cambios se guardarán al reconectar";
    case "conflict": return "Alguien más editó este sitio";
    case "invalid": return "Revisa los campos marcados";
    case "error": return status.failure.kind === "unauthenticated" ? "Tu sesión expiró. Inicia sesión para guardar los cambios." : "No se pudieron guardar los cambios";
    case "idle": return "";
  }
}
