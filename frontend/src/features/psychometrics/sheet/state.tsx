"use client";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { createComparisonAction, loadInvitationsAction, loadProfileAction, loadResultAction } from "../actions";
import { notifyActionResult } from "@/components/feedback/notify";
import { failureTitle, readConsequence } from "./feedback";
import type { AssessmentResult, Invitation, Profile, Result } from "../model";

const unavailable = { ok: false, reason: "no_response", reference: {} } as const;
const Context = createContext<{ items: Invitation[]; failed: boolean; reading: boolean; retry: () => void; adopt: (invitation: Invitation) => void } | null>(null);
export const useInvitations = () => useContext(Context);
/** Board-owned status read; never contains result data. A failed optional read stays quiet. */
export function InvitationsProvider({ vacancyId, movementKey, children }: { vacancyId: string; movementKey?: string; children: ReactNode }) {
  const [items, setItems] = useState<Invitation[]>([]);
  const [failed, setFailed] = useState(false);
  const [reading, setReading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const request = useRef<{ attempt: number; promise: ReturnType<typeof loadInvitationsAction> } | null>(null);
  const previousMovement = useRef(movementKey);
  const revision = useRef(0);
  useEffect(() => {
    let live = true;
    // The initial board arrival establishes the baseline, not an extra read.
    // A confirmed movement may have auto-created an invitation (contract endpoint 3).
    if (previousMovement.current !== undefined && previousMovement.current !== movementKey) request.current = null;
    previousMovement.current = movementKey;
    if (!request.current || request.current.attempt !== attempt) {
      setReading(true);
      request.current = { attempt, promise: loadInvitationsAction(vacancyId).catch(() => unavailable) };
    }
    const startedAt = revision.current;
    void request.current.promise.then(value => {
      if (!live || startedAt !== revision.current) return;
      if (value.ok) setItems(value.data.items);
      setFailed(!value.ok); setReading(false);
    });
    return () => { live = false; };
  }, [vacancyId, movementKey, attempt]);
  function adopt(invitation: Invitation) {
    // A confirmed write wins over older board reads. One latest invitation per participation.
    revision.current += 1;
    request.current = null;
    setItems(previous => [...previous.filter(item => item.participation_id !== invitation.participation_id), invitation]);
    setReading(false); setFailed(false);
  }
  return <Context.Provider value={{ items, failed, reading, adopt, retry: () => { setReading(true); setAttempt(n => n + 1); } }}>{children}</Context.Provider>;
}

/** Only an open sheet without an invitation needs the creation gate. Never fetch
 * this eagerly for cards or alongside the audited result's existing profile read. */
export function useInvitationProfile(vacancyId: string, needed: boolean) {
  const [profile, setProfile] = useState<Result<Profile> | null>(null);
  const request = useRef<ReturnType<typeof loadProfileAction> | null>(null);
  useEffect(() => {
    if (!needed) return;
    let live = true;
    request.current ??= loadProfileAction(vacancyId).catch(() => unavailable);
    void request.current.then(value => { if (live) setProfile(value); });
    return () => { live = false; };
  }, [vacancyId, needed]);
  return profile;
}

/** Owned by the open candidate session, not the mounted tab. An audited read is only
 * started on explicit opening; retaining the promise also deduplicates StrictMode effects. */
export function useSheetResult(vacancyId: string, invitation: Invitation | undefined, opened: boolean) {
  const [value, setValue] = useState<Result<AssessmentResult> | null>(null);
  const [profile, setProfile] = useState<Result<Profile> | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [comparing, setComparing] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [comparisonNotice, setComparisonNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const compareLock = useRef(false);
  const reported = useRef<unknown>(null);
  const live = useRef(true);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  const request = useRef<{ attempt: number; result: ReturnType<typeof loadResultAction>; profile: ReturnType<typeof loadProfileAction> } | null>(null);
  useEffect(() => {
    if (!opened || invitation?.status !== "finished") return;
    let live = true;
    if (!request.current || request.current.attempt !== attempt) {
      request.current = { attempt,
        result: loadResultAction({ vacancyId, invitationId: invitation.id }).catch(() => unavailable),
        profile: loadProfileAction(vacancyId).catch(() => unavailable) };
    }
    void request.current.result.then(next => { if (live) setValue(next); });
    void request.current.profile.then(next => { if (live) setProfile(next); });
    return () => { live = false; };
  }, [vacancyId, invitation?.id, invitation?.status, opened, attempt]);
  useEffect(() => {
    if (!value || value.ok || reported.current === value) return;
    reported.current = value;
    notifyActionResult({ key: "psychometric-read", type: "error", title: failureTitle(value.reason), description: readConsequence(value.reason), reference: { ...value.reference, code: value.reference.code ?? value.reason, at: new Date().toISOString() } });
  }, [value]);
  async function compare() {
    if (compareLock.current || uncertain || !value?.ok || !invitation) return;
    compareLock.current = true; setComparing(true); setComparisonNotice(null);
    const response = await createComparisonAction({ vacancyId, invitationId: invitation.id }).catch(() => unavailable);
    if (!live.current) return;
    if (response.ok) {
      const comparison = response.data;
      const updated: Result<AssessmentResult> = { ok: true, data: { ...value.data, latest_comparison: comparison, comparisons: [...value.data.comparisons, { id: comparison.id, profile_version: comparison.profile_version }] } };
      // Reopening the tab replays the retained read: it must carry the confirmed comparison, never the first GET.
      if (request.current) request.current = { ...request.current, result: Promise.resolve(updated) };
      setValue(updated);
      setComparisonNotice({ tone: "success", text: "Comparación actualizada" });
      notifyActionResult({ key: "psychometric-comparison", type: "success", title: "Comparación actualizada", description: "Las bandas originales y las comparaciones anteriores se conservaron." });
    } else {
      // POST creates history. An uncertain response must never be replayed blindly.
      const unknown = ["no_response", "server_error", "unrecognized_response"].includes(response.reason);
      setUncertain(unknown);
      setComparisonNotice({ tone: "error", text: "No se confirmó · conserva la comparación anterior" });
      notifyActionResult({ key: "psychometric-comparison", type: "error", title: failureTitle(response.reason), description: unknown ? "Se conserva la vista anterior. Cierra y vuelve a abrir la ficha para comprobar el historial antes de intentar otra comparación." : "Se conserva la comparación anterior. Revisa que el perfil esté confirmado y el proceso siga abierto.", reference: { ...response.reference, at: new Date().toISOString() } });
    }
    compareLock.current = false; setComparing(false);
  }
  return { value, profile, comparing, uncertain, comparisonNotice, compare, retry: () => { setValue(null); setAttempt(n => n + 1); } };
}
