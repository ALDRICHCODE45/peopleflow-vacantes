"use client";
import { useEffect, useRef, useState } from "react";
import { notifyActionResult } from "@/components/feedback/notify";
import { loadBoardAction, moveParticipationAction } from "./actions";
import { allowedMoveTargets, applyMoveToBoard, leavesPlacement } from "./helpers";
import { boardErrorCopy, moveErrorCopy, needsReconciliation, reconciliationCopy, type Notice } from "./board-feedback";
import type { Board, Failure, Participation, Result } from "./model";

type Confirmation = { item: Participation; target: string };
const noResponse: Failure = { ok: false, reason: "no_response", reference: {} };
async function readBoard(vacancyId: string): Promise<Result<Board>> {
  try { return await loadBoardAction(vacancyId); } catch { return noResponse; }
}

/** Each item has a synchronous mutex. Reconciliation waits for in-flight writes,
 * then performs one GET; no write is ever replayed by a read/retry path. */
export function useMovementBoard(vacancyId: string) {
  const [board, setBoard] = useState<Board | null>(null);
  const snapshot = useRef<Board | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [reading, setReading] = useState(true);
  const [stale, setStale] = useState(false);
  const mustRead = useRef(false);
  const readBusy = useRef(false);
  const [pending, setPending] = useState<Set<string>>(new Set());
  const locks = useRef(new Set<string>());
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const confirming = useRef<Confirmation | null>(null);
  const [notices, setNotices] = useState<Record<string, Notice>>({});
  const [readNotice, setReadNotice] = useState<Notice | null>(null);
  const reconcile = useRef(new Map<string, Failure>());
  // Concurrent responses have no shared coverage version: one final GET avoids
  // letting a late, older response overwrite the global coverage/milestone.
  const overlapping = useRef(false);
  const alive = useRef(false);
  function adopt(value: Board) { snapshot.current = value; setBoard(value); }
  function report(id: string, notice: Notice, reference?: Failure["reference"]) {
    setNotices(previous => ({ ...previous, [id]: notice }));
    notifyActionResult({ key: `pipeline-move-${id}`, type: notice.tone,
      title: notice.tone === "success" ? "Candidato movido" : "Revisa el movimiento", description: notice.text,
      ...(notice.tone === "error" ? { reference: { ...reference, at: new Date().toISOString() } } : {}) });
  }
  useEffect(() => {
    alive.current = true;
    let current = true;
    void readBoard(vacancyId).then(result => {
      if (!current) return;
      if (result.ok) { snapshot.current = result.data; setBoard(result.data); } else setFailure(result);
      setReading(false);
    });
    return () => { current = false; alive.current = false; };
  }, [vacancyId]);

  async function reconcileOnce() {
    if ((!reconcile.current.size && !overlapping.current) || readBusy.current || locks.current.size) return;
    const requested = new Map(reconcile.current);
    reconcile.current.clear(); overlapping.current = false;
    readBusy.current = true; mustRead.current = true; setStale(true); setReading(true);
    const result = await readBoard(vacancyId);
    if (!alive.current) return;
    if (result.ok) { adopt(result.data); setFailure(null); mustRead.current = false; setStale(false); }
    else setFailure(result);
    for (const [id, failure] of requested) {
      report(id, { tone: "error", text: reconciliationCopy(failure.reason, result.ok) }, failure.reference);
    }
    readBusy.current = false; setReading(false);
  }
  async function retry() {
    if (readBusy.current || locks.current.size) return;
    readBusy.current = true; setReading(true); setReadNotice(null);
    const result = await readBoard(vacancyId);
    if (!alive.current) return;
    const notice: Notice = result.ok ? { tone: "info", text: "Tablero actualizado" } : { tone: "error", text: boardErrorCopy(result.reason).title };
    if (result.ok) { adopt(result.data); setFailure(null); mustRead.current = false; setStale(false); }
    else setFailure(result);
    setReadNotice(notice);
    notifyActionResult({ key: "pipeline-board-read", type: notice.tone, title: notice.text,
      description: result.ok ? "Revisa las etapas actuales. No repetimos ningún movimiento." : boardErrorCopy(result.reason).description,
      ...(!result.ok ? { reference: { ...result.reference, at: new Date().toISOString() } } : {}) });
    readBusy.current = false; setReading(false);
  }
  async function submit(item: Participation, target: string, confirmed = false) {
    if (locks.current.has(item.id) || mustRead.current || readBusy.current) return;
    if (locks.current.size) overlapping.current = true;
    locks.current.add(item.id); setPending(new Set(locks.current));
    setNotices(previous => { const next = { ...previous }; delete next[item.id]; return next; });
    let result;
    try { result = await moveParticipationAction({ vacancyId, participationId: item.id, etag: item.etag,
      body: { to_stage_id: target, ...(confirmed ? { confirm_placement_exit: true } : {}) } }); }
    catch { result = { ok: false, reason: "uncertain", reference: {} } as const; }
    if (!alive.current) return;
    if (result.ok) {
      if (snapshot.current) adopt(applyMoveToBoard(snapshot.current, result.data));
      report(item.id, { tone: "success", text: "Candidato movido" });
      if (confirming.current?.item.id === item.id) { confirming.current = null; setConfirmation(null); }
    } else if (result.reason === "placement_exit_confirmation_required") {
      const next = { item, target }; confirming.current = next; setConfirmation(next);
    } else {
      if (confirming.current?.item.id === item.id) { confirming.current = null; setConfirmation(null); }
      if (needsReconciliation(result)) {
        mustRead.current = true; setStale(true);
        reconcile.current.set(item.id, result);
      } else report(item.id, { tone: "error", text: moveErrorCopy(result.reason) }, result.reference);
    }
    locks.current.delete(item.id); setPending(new Set(locks.current));
    await reconcileOnce();
  }
  function requestMove(id: string, target: string) {
    const current = snapshot.current;
    const item = current?.participations.find(item => item.id === id);
    if (!current || !item || locks.current.has(id) || mustRead.current || readBusy.current || confirming.current) return;
    if (!allowedMoveTargets(current, item).some(stage => stage.id === target)) return;
    if (leavesPlacement(current, item, target)) {
      const next = { item, target }; confirming.current = next; setConfirmation(next);
    } else void submit(item, target);
  }
  function closeConfirmation() {
    if (confirmation && locks.current.has(confirmation.item.id)) return;
    confirming.current = null; setConfirmation(null);
  }
  function confirmMove() {
    if (confirmation) void submit(confirmation.item, confirmation.target, true);
  }
  return { board, failure, reading, stale, pending, notices, readNotice, confirmation, retry, requestMove, closeConfirmation, confirmMove };
}
