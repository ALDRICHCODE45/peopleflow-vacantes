"use client";

import * as React from "react";
import { dismissActionResult } from "@/components/feedback/notify";
import { notifyDraftSaveResult } from "./draft-save-feedback";
import { saveDraftV2Action, type DraftSaveResult } from "../actions";
import {
  draftV2SnapshotToPatchBody,
  draftV2SnapshotToPostBody,
} from "../screening-v2/wire";
import type { LocalDraftV2Snapshot } from "./draft-screening-v2-state";

export type DraftIdentity = { draftId: string; etag: string };

/** In-memory identity/key only: no autosave, automatic retries or browser credentials. */
export function useDraftSave(initialIdentity?: DraftIdentity) {
  const identity = React.useRef<DraftIdentity | null>(initialIdentity ?? null);
  const createKey = React.useRef<string | null>(null);
  const inFlight = React.useRef(false);
  const revision = React.useRef(0);
  const [pending, setPending] = React.useState(false);
  const [result, setResult] = React.useState<DraftSaveResult | null>(null);
  const [dirty, setDirty] = React.useState(false);

  function edited() {
    revision.current += 1;
    setDirty(true);
  }

  async function save(snapshot: LocalDraftV2Snapshot) {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    setResult(null);
    const attemptedAt = new Date().toISOString();
    dismissActionResult("draft-save");
    const savingRevision = revision.current;
    try {
      const body = identity.current
        ? draftV2SnapshotToPatchBody(snapshot)
        : draftV2SnapshotToPostBody(snapshot);
      // Keep the key on every failure, including disconnects and changed-body
      // conflicts. Only a confirmed create may release it.
      if (!identity.current && !createKey.current) {
        createKey.current = crypto.randomUUID();
      }
      const response = await saveDraftV2Action(
        identity.current
          ? { ...identity.current, body }
          : { idempotencyKey: createKey.current!, body },
      );
      setResult(response);
      notifyDraftSaveResult(response, identity.current !== null, attemptedAt);
      if (response.ok) {
        const created = identity.current === null;
        identity.current = { draftId: response.draftId, etag: response.etag };
        if (created) {
          // Preserve Next's history state and this mounted editor, including edits
          // made while awaiting the create. Never navigate/remount through router.replace.
          window.history.replaceState(window.history.state, "", `/empresa/vacantes/borradores/${response.draftId}`);
        }
        createKey.current = null;
        // The user may have navigated back and edited while this write waited.
        setDirty(revision.current !== savingRevision);
      }
      return revision.current === savingRevision ? response : undefined;
    } catch {
      // A rejected Server Action may have completed its write before disconnecting.
      const failure = { ok: false, reason: "no_response", reference: {} } as const;
      setResult(failure);
      notifyDraftSaveResult(failure, identity.current !== null, attemptedAt);
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }

  return { save, edited, pending, result, dirty, saved: identity.current !== null };
}
