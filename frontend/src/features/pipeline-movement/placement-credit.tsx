"use client";

import { useEffect, useRef, useState } from "react";
import { Ban, RotateCcw } from "lucide-react";
import { ActionBar, ActionStatus, ActionStatusSlot } from "@/components/feedback/action-status";
import { ConfirmActionDialog } from "@/components/feedback/confirm-action-dialog";
import { notifyActionResult } from "@/components/feedback/notify";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { correctPlacementCreditAction, loadParticipationAction, loadPlacementCreditsAction } from "./actions";
import { MovementDate } from "./board-states";
import { initials } from "./pipeline-presentation";
import type { Failure, ParticipationDetail, PlacementCredit } from "./model";

const statusLabel = { active: "Activo", did_not_hold: "No se sostuvo", voided: "Anulado" };
const statusTone = { active: "success", did_not_hold: "review", voided: "neutral" } as const;
const kindLabel = { direct: "Crédito directo", participant: "Participó", shared: "Crédito compartido" };
function CreditBadge({ status }: { status: PlacementCredit["status"] }) {
  return <Badge variant={statusTone[status]} dot>{statusLabel[status]}</Badge>;
}
function errorCopy(failure: Failure) {
  switch (failure.reason) {
    case "credit_status_unchanged": return "El crédito ya estaba en ese estado.";
    case "forbidden": return "No tienes permiso para esta acción.";
    case "team_access_ended": return "Ya no formas parte del equipo de esta vacante";
    case "unauthenticated": return "Tu sesión expiró. Inicia sesión de nuevo.";
    case "uncertain": case "unrecognized_response": return "No pudimos confirmar el cambio. Es seguro reintentar este mismo intento.";
    default: return "No se pudo cambiar el crédito. Revisa los datos e inténtalo de nuevo.";
  }
}
type Props = { vacancyId: string; detail: ParticipationDetail; onDetail: (detail: ParticipationDetail) => void; onAccessEnded: (failure: Failure) => void };
/** Card-less summary section, following the sheet's existing heading/spacing and Equipo avatar rows. */
export function PlacementCreditBlock(props: Props) {
  return props.detail.placement_credit ? <CreditSection key={props.detail.placement_credit.id} {...props} credit={props.detail.placement_credit} /> : null;
}
function CreditSection({ vacancyId, detail, credit, onDetail, onAccessEnded }: Props & { credit: PlacementCredit }) {
  const [credits, setCredits] = useState<PlacementCredit[] | null>(null);
  const [listFailed, setListFailed] = useState(false);
  const [listAttempt, setListAttempt] = useState(0);
  const [dialog, setDialog] = useState<"void" | "restore" | null>(null);
  const [pending, setPending] = useState(false);
  const [refreshNeeded, setRefreshNeeded] = useState(false);
  const [confirmedCredit, setConfirmedCredit] = useState<PlacementCredit | null>(null);
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const attempt = useRef<Parameters<typeof correctPlacementCreditAction>[0] | null>(null);
  const busy = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    let current = true;
    setListFailed(false);
    void loadPlacementCreditsAction(vacancyId, detail.id).then(result => {
      if (!current) return;
      if (result.ok) setCredits(result.data.items);
      else { setListFailed(true); if (result.reason === "team_access_ended") onAccessEnded(result); }
    }).catch(() => { if (current) setListFailed(true); });
    return () => { current = false; };
  }, [vacancyId, detail.id, credit.id, credit.status, listAttempt, onAccessEnded]);
  async function refresh() {
    let result;
    try { result = await loadParticipationAction(vacancyId, detail.id); }
    catch { result = { ok: false, reason: "no_response", reference: {} } as const; }
    if (!mounted.current) return false;
    if (result.ok) {
      onDetail(result.data); setRefreshNeeded(false); setConfirmedCredit(null); setListAttempt(value => value + 1);
      return true;
    }
    if (result.reason === "team_access_ended") onAccessEnded(result);
    setRefreshNeeded(true);
    setNotice({ tone: "error", text: "El cambio se guardó. Actualiza el detalle antes de continuar." });
    return false;
  }
  async function confirm() {
    if (!dialog || busy.current || refreshNeeded || !(dialog === "void" ? detail.can.void_credit : detail.can.restore_credit)) return;
    busy.current = true; setPending(true); setNotice(null);
    // Like team writes, freeze the UUID and target for the lifetime of an uncertain attempt.
    attempt.current ??= { vacancyId, participationId: detail.id, creditId: credit.id, action: dialog, idempotencyKey: crypto.randomUUID() };
    let result;
    try { result = await correctPlacementCreditAction(attempt.current); }
    catch { result = { ok: false, reason: "uncertain", reference: {} } as const; }
    if (!mounted.current) { busy.current = false; return; }
    if (result.ok) {
      attempt.current = null; setDialog(null); setConfirmedCredit(result.data);
      const fresh = await refresh();
      if (mounted.current) {
        const text = dialog === "void" ? "Crédito anulado" : "Crédito restaurado";
        if (fresh) setNotice({ tone: "success", text });
        notifyActionResult({ key: "placement-credit", type: fresh ? "success" : "warning", title: text, description: fresh ? "El detalle muestra el estado actual del crédito." : "El cambio se guardó. Actualiza el detalle para consultar sus permisos." });
      }
    } else {
      if (result.reference.status && result.reference.status >= 400 && result.reference.status < 500) attempt.current = null;
      const text = errorCopy(result);
      setNotice({ tone: "error", text });
      notifyActionResult({ key: "placement-credit", type: "error", title: "No se confirmó el cambio", description: text, reference: { ...result.reference, at: new Date().toISOString() } });
      if (result.reason === "team_access_ended") onAccessEnded(result);
    }
    busy.current = false; if (mounted.current) setPending(false);
  }
  const kindOrder = { direct: 0, shared: 1, participant: 2 } as const;
  const shown = confirmedCredit ?? credit;
  const previous = credits?.filter(item => item.id !== credit.id).slice(0, 3) ?? [];
  const status = notice ? <ActionStatus id="credit-action-status" tone={notice.tone} text={notice.text} /> : null;
  function open(action: "void" | "restore") { attempt.current = null; setNotice(null); setDialog(action); }
  return <section aria-label="Crédito del placement" className="flex flex-col gap-3">
    <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground">Crédito del placement</h3><CreditBadge status={shown.status} /></div>
    <p className="text-xs leading-5 text-muted-foreground">Colocado el <MovementDate value={shown.hired_at} /> por {shown.hired_by.name} · {shown.team_mode === "with_responsible" ? "Con responsable" : "Equipo sin responsable"}</p>
    <ul className="flex flex-col gap-3">{[...shown.recipients].sort((a, b) => kindOrder[a.kind] - kindOrder[b.kind]).map(recipient => <li key={recipient.user_id} className="flex min-w-0 items-center gap-3">
      {/* No photo in the frozen credit contract: use the installed Avatar's initials fallback. */}
      <Avatar><AvatarFallback>{initials(recipient.name)}</AvatarFallback></Avatar>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5"><p className="break-words text-sm font-medium">{recipient.name}</p><p className="text-xs text-muted-foreground">{kindLabel[recipient.kind]}</p></div>
    </li>)}</ul>
    {shown.status !== "active" && shown.exit_reason && <p className="text-xs text-muted-foreground">{shown.exit_reason === "candidate_left" ? "El candidato se fue" : "Se movió por error"}</p>}
    {(detail.can.void_credit || detail.can.restore_credit || notice) && <ActionBar status={dialog ? null : status}>
      {detail.can.void_credit && <Button type="button" variant="outline" className="min-h-10 border-destructive/25 text-destructive" disabled={pending || refreshNeeded} aria-describedby={notice && !dialog ? "credit-action-status" : undefined} onClick={() => open("void")}><Ban aria-hidden="true" data-icon="inline-start" />Anular crédito</Button>}
      {detail.can.restore_credit && <Button type="button" variant="outline" className="min-h-10" disabled={pending || refreshNeeded} aria-describedby={notice && !dialog ? "credit-action-status" : undefined} onClick={() => open("restore")}><RotateCcw aria-hidden="true" data-icon="inline-start" />Restaurar crédito</Button>}
    </ActionBar>}
    {refreshNeeded && <Button type="button" variant="outline" disabled={pending} onClick={() => { if (busy.current) return; busy.current = true; setPending(true); void refresh().finally(() => { busy.current = false; if (mounted.current) setPending(false); }); }}>Actualizar detalle</Button>}
    {!credits && !listFailed && <div aria-busy="true" aria-label="Consultando colocaciones anteriores" className="flex flex-col gap-2"><Skeleton className="h-4 w-40" /><Skeleton className="h-5 w-48" /></div>}
    {listFailed ? <div className="flex flex-col gap-2"><ActionStatus id="credit-list-status" tone="error" text="No pudimos consultar las colocaciones anteriores." /><Button type="button" variant="outline" aria-describedby="credit-list-status" onClick={() => setListAttempt(value => value + 1)}>Reintentar consulta</Button></div> : previous.length > 0 && <div className="flex flex-col gap-2"><h4 className="text-xs font-medium text-muted-foreground">Colocaciones anteriores</h4><ul aria-label="Colocaciones anteriores" className="flex flex-col gap-2">{previous.map(item => <li key={item.id} className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground"><MovementDate value={item.hired_at} /><span aria-hidden="true">·</span><CreditBadge status={item.status} /></li>)}</ul></div>}
    {dialog && <ConfirmActionDialog open onOpenChange={open => { if (!open && !pending) setDialog(null); }} icon={dialog === "void" ? Ban : RotateCcw} title={dialog === "void" ? "Anular crédito" : "Restaurar crédito"} description={dialog === "void" ? "El placement deja de contar como crédito para estas personas. La colocación y su historial se conservan." : 'El crédito vuelve a contar para las mismas personas. Si su colocación ya terminó, vuelve como "No se sostuvo".'} confirmLabel={dialog === "void" ? "Anular crédito" : "Restaurar crédito"} pendingLabel="Guardando…" tone={dialog === "void" ? "destructive" : "default"} pending={pending} onConfirm={() => void confirm()}>
      {/* Only an error reserves room: an empty slot left a blank gap above the footer (browser review). The toast also announces it. */}
      {status && <ActionStatusSlot>{status}</ActionStatusSlot>}
    </ConfirmActionDialog>}
  </section>;
}
