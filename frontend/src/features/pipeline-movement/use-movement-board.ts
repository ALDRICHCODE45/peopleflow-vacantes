"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Lifecycle } from "@/features/vacancy-lifecycle/model";
import { loadDeliveryStatusAction } from "@/features/jobs/drafts/pipeline/delivery-actions";
import { fulfillmentToast, type DeliveryStatus } from "@/features/jobs/drafts/pipeline/fulfillment-model";
import { notifyActionResult } from "@/components/feedback/notify";
import { loadBoardAction, moveParticipationAction, discardParticipationAction, recoverParticipationAction, setParticipationSubstateAction } from "./actions";
import { allowedMoveTargets, applyParticipationToBoard, leavesPlacement } from "./helpers";
import { boardErrorCopy, moveErrorCopy, needsReconciliation, reconciliationCopy, type Notice } from "./board-feedback";
import type { Board, DiscardBody, Failure, Participation, RecoverBody, Result } from "./model";
import { useBoardColumnOrder } from "./use-board-column-order";
import { isInProcess } from "./substates";
import { boardSuccessCopy, type BoardWrite } from "./board-toast-copy";
import { recoverySelection } from "./recovery";
export type Disposition = { kind: "discard" | "recover"; item: Participation; placementConfirmation: boolean; recoveryRequired?: boolean };

type Confirmation = { item: Participation; target: string; placementExit: boolean };
const noResponse: Failure = { ok: false, reason: "no_response", reference: {} };
async function readBoard(vacancyId: string): Promise<Result<Board>> {
  try { return await loadBoardAction(vacancyId); } catch { return noResponse; }
}

/** Each item has a synchronous mutex. Reconciliation waits for in-flight writes,
 * then performs one GET; no write is ever replayed by a read/retry path. */
export function useMovementBoard(vacancyId: string) {
  const [board, setBoard] = useState<Board | null>(null);
  const snapshot = useRef<Board | null>(null);
  const [deliveryStatus, setDeliveryStatus] = useState<DeliveryStatus | null>(null);
  const statusSequence = useRef(0);
  const fulfillmentAnnounced = useRef(false);
  const alive = useRef(false);
  const invalidateDelivery = useCallback(() => { statusSequence.current++; }, []);
  const refreshDelivery = useCallback(async (announce = false) => {
    const sequence = ++statusSequence.current;
    let details: DeliveryStatus | null = null;
    try { const result = await loadDeliveryStatusAction(vacancyId); if (result.ok) details = result.status; } catch { /* Keep the server-confirmed summary without inventing details. */ }
    if (!alive.current) return;
    if (sequence === statusSequence.current) setDeliveryStatus(details);
    if (announce) notifyActionResult({ key: "pipeline-delivery", type: "success", title: "Entrega cumplida", description: fulfillmentToast(details?.state === "fulfilled" ? details.fulfillment : null) });
  }, [vacancyId]);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [reading, setReading] = useState(true);
  const [stale, setStale] = useState(false);
  const mustRead = useRef(false);
  const readBusy = useRef(false);
  const [pending, setPending] = useState<Set<string>>(new Set());
  const locks = useRef(new Set<string>());
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const confirming = useRef<Confirmation | null>(null);
  const [substateConfirmation, setSubstateConfirmation] = useState<{ item: Participation; value: string | null } | null>(null);
  const substateIntent = useRef<typeof substateConfirmation>(null);
  const [disposition, setDisposition] = useState<Disposition | null>(null);
  const disposing = useRef<Disposition | null>(null);
  const [notices, setNotices] = useState<Record<string, Notice>>({});
  const [readNotice, setReadNotice] = useState<Notice | null>(null);
  const reconcile = useRef(new Map<string, Failure>());
  // Concurrent responses have no shared coverage version: one final GET avoids
  // letting a late, older response overwrite the global coverage/milestone.
  const overlapping = useRef(false);
  const columns = useBoardColumnOrder(vacancyId, board, board?.lifecycle.process === "finished" || stale || reading || pending.size > 0 || !!confirmation || !!disposition || !!substateConfirmation, reloadOrder);
  async function reloadOrder() {
    if (readBusy.current || locks.current.size) return false;
    readBusy.current = true; mustRead.current = true; setStale(true); setReading(true);
    const result = await readBoard(vacancyId);
    if (!alive.current) return false;
    if (result.ok) { adopt(result.data); setFailure(null); mustRead.current = false; setStale(false); }
    else setFailure(result);
    readBusy.current = false; setReading(false);
    return result.ok;
  }
  function updateLifecycle(lifecycle: Lifecycle) {
    const current = snapshot.current;
    if (!current || BigInt(lifecycle.version) < BigInt(current.lifecycle.version)) return;
    snapshot.current = { ...current, lifecycle }; setBoard(snapshot.current);
    if (lifecycle.process === "finished") {
      confirming.current = null; setConfirmation(null);
      disposing.current = null; setDisposition(null);
      substateIntent.current = null; setSubstateConfirmation(null);
      reconcile.current.clear(); overlapping.current = false;
    }
  }
  function adopt(value: Board, readStatus = true) {
    if (snapshot.current && BigInt(snapshot.current.lifecycle.version) > BigInt(value.lifecycle.version)) value = { ...value, lifecycle: snapshot.current.lifecycle };
    snapshot.current = value; setBoard(value); if (readStatus) void refreshDelivery();
    if (disposing.current?.recoveryRequired) {
      const item = value.participations.find(item => item.id === disposing.current?.item.id);
      const next = item?.discard ? { ...disposing.current, item } : null;
      disposing.current = next; setDisposition(next);
    }
  }
  function report(id: string, notice: Notice, title: string, reference?: Failure["reference"]) {
    setNotices(previous => ({ ...previous, [id]: notice }));
    notifyActionResult({ key: `pipeline-move-${id}`, type: notice.tone,
      title, description: notice.text,
      ...(notice.tone === "error" ? { reference: { ...reference, at: new Date().toISOString() } } : {}) });
  }
  useEffect(() => {
    alive.current = true;
    let current = true;
    void readBoard(vacancyId).then(result => {
      if (!current) return;
      if (result.ok) { snapshot.current = result.data; setBoard(result.data); fulfillmentAnnounced.current = result.data.delivery.state === "fulfilled"; void refreshDelivery(); } else setFailure(result);
      setReading(false);
    });
    return () => { current = false; alive.current = false; invalidateDelivery(); };
  }, [vacancyId, refreshDelivery, invalidateDelivery]);

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
      report(id, { tone: "error", text: reconciliationCopy(failure.reason, result.ok) }, "Actualizamos el tablero", failure.reference);
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
  async function submit(item: Participation, write: BoardWrite) {
    const actionBoard = snapshot.current;
    if (!actionBoard || actionBoard.lifecycle.process === "finished" || locks.current.has(item.id) || mustRead.current || readBusy.current) return;
    if (locks.current.size) overlapping.current = true;
    locks.current.add(item.id); setPending(new Set(locks.current));
    setNotices(previous => { const next = { ...previous }; delete next[item.id]; return next; });
    let result;
    try {
      const input = { vacancyId, participationId: item.id, etag: item.etag };
      result = write.kind === "move"
        ? await moveParticipationAction({ ...input, body: { to_stage_id: write.target, ...(write.confirmed ? { confirm_placement_exit: true } : {}) } })
        : write.kind === "substate"
          ? await setParticipationSubstateAction({ ...input, body: { substate_id: write.substateId } })
        : write.kind === "discard"
          ? await discardParticipationAction({ ...input, body: write.body })
          : await recoverParticipationAction({ ...input, body: { ...(write.confirmed ? { confirm_placement_reentry: true } : {}), ...(write.target ? { to_stage_id: write.target } : {}) } });
    }
    catch { result = { ok: false, reason: "uncertain", reference: {} } as const; }
    if (!alive.current) return;
    if (result.ok) {
      const previousDelivery = snapshot.current?.delivery;
      if (snapshot.current) adopt(applyParticipationToBoard(snapshot.current, result.data), false);
      const fulfilledNow = previousDelivery?.state === "pending" && result.data.delivery.state === "fulfilled" && !fulfillmentAnnounced.current;
      if (fulfilledNow) fulfillmentAnnounced.current = true;
      if (previousDelivery?.state !== snapshot.current?.delivery.state || previousDelivery?.delivered !== snapshot.current?.delivery.delivered || previousDelivery?.target !== snapshot.current?.delivery.target) void refreshDelivery(fulfilledNow);
      const copy = boardSuccessCopy(actionBoard, item, write, result.data);
      report(item.id, { tone: "success", text: copy.description }, copy.title);
      if (confirming.current?.item.id === item.id) { confirming.current = null; setConfirmation(null); }
      if (disposing.current?.item.id === item.id) { disposing.current = null; setDisposition(null); }
    } else if (result.reason === "process_finished" && result.lifecycle) {
      updateLifecycle(result.lifecycle);
    } else if (write.kind === "move" && result.reason === "placement_exit_confirmation_required") {
      const next = { item, target: write.target, placementExit: true }; confirming.current = next; setConfirmation(next);
    } else if ((write.kind === "discard" || write.kind === "recover") && (result.reason === "placement_exit_confirmation_required" || result.reason === "placement_reentry_confirmation_required")) {
      // The next write is possible only after another explicit confirmation.
      const next: Disposition = { kind: write.kind, item, placementConfirmation: true };
      disposing.current = next; setDisposition(next);
      report(item.id, { tone: "info", text: "Confirma la consecuencia sobre las plazas cubiertas antes de continuar." }, "Confirma el cambio de cobertura");
    } else {
      if (confirming.current?.item.id === item.id) { confirming.current = null; setConfirmation(null); }
      if (needsReconciliation(result)) {
        if (disposing.current?.item.id === item.id) {
          const next = result.reason === "recovery_stage_required" ? { ...disposing.current, recoveryRequired: true } : null;
          disposing.current = next; setDisposition(next);
        }
        mustRead.current = true; setStale(true);
        reconcile.current.set(item.id, result);
      } else {
        const title = write.kind === "substate" ? `No se guardó el subestado de ${item.candidate.full_name}` : write.kind === "move" ? `No se movió a ${item.candidate.full_name}` : write.kind === "discard" ? `No se descartó a ${item.candidate.full_name}` : `No se recuperó a ${item.candidate.full_name}`;
        report(item.id, { tone: "error", text: write.kind === "substate" ? result.reason === "validation_error" ? "No se guardó el subestado. Elige una opción del catálogo actual." : "No se guardó el subestado. Revisa tu sesión y los permisos antes de intentar de nuevo." : write.kind === "move" ? moveErrorCopy(result.reason) : result.reason === "validation_error" ? write.kind === "recover" ? "No se recuperó. Revisa la columna de regreso y elige una opción permitida antes de confirmar otra vez." : "No se guardó. Revisa los datos e intenta de nuevo." : "No se guardó. Revisa tu sesión y los permisos antes de intentar de nuevo." }, title, result.reference);
      }
    }
    if (substateIntent.current?.item.id === item.id) { substateIntent.current = null; setSubstateConfirmation(null); }
    locks.current.delete(item.id); setPending(new Set(locks.current));
    await reconcileOnce();
  }
  function setSubstate(id: string, substateId: string | null) {
    if (snapshot.current?.lifecycle.process === "finished" || columns.busy || columns.confirmation) return;
    const current = snapshot.current;
    const item = current?.participations.find(item => item.id === id);
    if (!current || !item || !isInProcess(current, item) || confirming.current || disposing.current || substateIntent.current || locks.current.has(id) || mustRead.current || readBusy.current) return;
    if (item.substate_id === substateId || (substateId !== null && !current.substates.some(substate => substate.id === substateId))) return;
    const next = { item, value: substateId }; substateIntent.current = next; setSubstateConfirmation(next);
  }
  function requestMove(id: string, target: string) {
    if (snapshot.current?.lifecycle.process === "finished" || columns.busy || columns.confirmation) return;
    const current = snapshot.current;
    const item = current?.participations.find(item => item.id === id);
    if (!current || !item || locks.current.has(id) || mustRead.current || readBusy.current || (confirming.current && !locks.current.has(confirming.current.item.id)) || disposing.current) return;
    if (!allowedMoveTargets(current, item).some(stage => stage.id === target)) return;
    if (substateIntent.current) return;
    const next = { item, target, placementExit: leavesPlacement(current, item, target) }; confirming.current = next; setConfirmation(next);
  }
  function closeConfirmation() {
    if (confirmation && locks.current.has(confirmation.item.id)) return;
    confirming.current = null; setConfirmation(null);
  }
  function confirmMove() {
    const current = confirming.current;
    if (current) void submit(current.item, { kind: "move", target: current.target, confirmed: current.placementExit });
  }
  function closeSubstateConfirmation() {
    if (substateIntent.current && locks.current.has(substateIntent.current.item.id)) return;
    substateIntent.current = null; setSubstateConfirmation(null);
  }
  function confirmSubstate() {
    const current = substateIntent.current;
    if (current) void submit(current.item, { kind: "substate", substateId: current.value });
  }
  function requestDisposition(id: string, kind: Disposition["kind"]) {
    if (snapshot.current?.lifecycle.process === "finished" || columns.busy || columns.confirmation) return;
    if (substateIntent.current) return;
    const current = snapshot.current;
    const item = current?.participations.find(item => item.id === id);
    if (!current || !item || locks.current.has(id) || mustRead.current || readBusy.current || confirming.current || disposing.current) return;
    if (kind === "discard" ? !!item.discard || item.stage_id === current.exit.id : !item.discard || item.stage_id !== current.exit.id) return;
    const placementId = kind === "discard" ? item.stage_id : item.discard!.previous_stage_id;
    const next = { kind, item, placementConfirmation: current.stages.some(stage => stage.id === placementId && stage.kind === "placement") };
    disposing.current = next; setDisposition(next);
    setNotices(previous => { const next = { ...previous }; delete next[id]; return next; });
  }
  function closeDisposition() {
    if (disposing.current && locks.current.has(disposing.current.item.id)) return;
    disposing.current = null; setDisposition(null);
  }
  function confirmDisposition(body?: DiscardBody | RecoverBody) {
    const current = disposing.current;
    if (!current || !snapshot.current) return;
    if (current.kind === "discard" && body && "reason" in body) void submit(current.item, { kind: "discard", body: { ...body, ...(current.placementConfirmation ? { confirm_placement_exit: true } : {}) } });
    if (current.kind === "recover") {
      const recovery = recoverySelection(snapshot.current, current.item, current.recoveryRequired);
      const target = body && "to_stage_id" in body ? body.to_stage_id : undefined;
      if (recovery.required && !recovery.stages.some(stage => stage.id === target)) return;
      void submit(current.item, { kind: "recover", confirmed: current.placementConfirmation, ...(recovery.required ? { target } : {}) });
    }
  }
  function addCandidate(value: import("@/features/manual-intake/model").IntakeResponse) {
    const current = snapshot.current;
    if (!current) return;
    const { coverage, delivery, ...item } = value;
    const participations = [...current.participations.filter(entry => entry.id !== item.id), item];
    adopt({ ...current, coverage, delivery, participations, stages: current.stages.map(stage => ({ ...stage, count: participations.filter(entry => entry.stage_id === stage.id).length })) });
    // A concurrently pending card mutation has no global coverage version.
    if (locks.current.size) overlapping.current = true;
  }
  return { addCandidate, updateLifecycle, board: columns.board, deliveryStatus, columns, failure, reading, stale, pending, notices, readNotice, confirmation, substateConfirmation, closeSubstateConfirmation, confirmSubstate, disposition, retry, setSubstate, requestMove, closeConfirmation, confirmMove, requestDisposition, closeDisposition, confirmDisposition };
}
