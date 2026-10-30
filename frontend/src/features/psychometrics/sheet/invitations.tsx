"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Bell, CalendarDays, ClipboardList, Clock3, Copy, Ellipsis, Send, ShieldX, UserRound } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Progress } from "@/components/ui/progress";
import { Spinner } from "@/components/ui/spinner";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Item, ItemActions, ItemContent, ItemDescription, ItemTitle } from "@/components/ui/item";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { plural } from "@/features/employer-vacancies/plural";
import { ActionStatus, ActionStatusSlot } from "@/components/feedback/action-status";
import { ConfirmActionDialog } from "@/components/feedback/confirm-action-dialog";
import { notifyActionResult } from "@/components/feedback/notify";
import { MovementDate } from "@/features/pipeline-movement/board-states";
import { createInvitationAction, mintLinkAction, remindInvitationAction, revokeInvitationAction } from "../actions";
import { candidateUrl } from "../link";
import { invitationStatusLabels as statusLabels } from "./invitation-labels";
import type { Invitation, Result } from "../model";
import { failureTitle } from "./feedback";
import { useInvitations } from "./state";

type Operation = "send" | "copy" | "remind" | "revoke";
const operations = {
  send: { label: "Enviar evaluación", icon: Send, title: "¿Enviar evaluación", description: "Se crea una invitación, no se envía correo. Después podrás copiar el enlace. La persona no cambia de etapa." },
  copy: { label: "Copiar enlace", icon: Copy, title: "¿Copiar un enlace nuevo", description: "El enlace anterior deja de funcionar. Se genera un enlace nuevo; el avance se conserva y la fecha de vencimiento no cambia." },
  remind: { label: "Recordar", icon: Bell, title: "¿Registrar un recordatorio", description: "El enlace anterior deja de funcionar. Se registra el recordatorio y se copia un enlace nuevo; tú lo compartes, no se envía correo. El avance y la fecha de vencimiento no cambian." },
  revoke: { label: "Revocar", icon: ShieldX, title: "¿Revocar la evaluación", description: "Revocar impide continuar por enlace o cuenta. El historial se conserva y la persona no cambia de etapa." },
};
const unavailable = { ok: false, reason: "no_response", reference: {} } as const;
const consequence = (reason: Exclude<Result<unknown>, { ok: true }>["reason"]) => {
  switch (reason) {
    case "profile_disabled": return "Activa el perfil en Configuración de psicometría y vuelve a intentarlo. No se creó una invitación.";
    case "already_finished": return "Esta participación ya tiene una evaluación finalizada. Actualiza la psicometría para consultarla; no se creó otra invitación.";
    case "participation_inactive": return "La participación está descartada o salió del proceso. Revisa su estado antes de enviar; no se creó una invitación.";
    case "process_finished": return "El proceso finalizó. Reabre la vacante para gestionar invitaciones; no se aplicó el cambio.";
    case "invitation_closed": return "La invitación ya está cerrada. Actualiza su estado antes de continuar.";
    case "unauthenticated": return "Inicia sesión de nuevo. Se conserva la vista anterior.";
    case "forbidden": return "Solo el equipo de reclutamiento autorizado puede gestionar esta invitación.";
    default: return "Se conserva la vista anterior. Comprueba la invitación antes de volver a intentar; no se repetirá la escritura automáticamente.";
  }
};

/** The open candidate session owns writes and uncertainty, so switching tabs does
 * not erase a failed reminder or turn it into a silent duplicate. No bearer state. */
export function useInvitationManagement({ vacancyId, participationId, invitation, locked }: { vacancyId: string; participationId: string; invitation?: Invitation; locked: boolean }) {
  const context = useInvitations();
  const [confirmation, setConfirmation] = useState<Operation | null>(null);
  const [pending, setPending] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [checking, setChecking] = useState(false);
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string; configuration?: boolean; operation: Operation } | null>(null);
  const lock = useRef(false);
  const live = useRef(true);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  useEffect(() => {
    if (checking && context && !context.reading) {
      setChecking(false);
      if (!context.failed) setUncertain(false);
    }
  }, [checking, context]);
  function fail(response: Exclude<Result<unknown>, { ok: true }>, text: string, prefix = "") {
    if (!live.current) return;
    setNotice({ tone: "error", text, configuration: response.reason === "profile_disabled", operation: confirmation! });
    if (["no_response", "server_error", "unrecognized_response", "invitation_closed", "already_finished"].includes(response.reason)) setUncertain(true);
    notifyActionResult({ key: "psychometric-invitation", type: "error", title: failureTitle(response.reason), description: prefix + consequence(response.reason), reference: { ...response.reference, code: response.reference.code ?? response.reason, at: new Date().toISOString() } });
  }
  async function execute() {
    const operation = confirmation;
    if (!operation || lock.current || locked || uncertain || !context || (operation !== "send" && !invitation)) return;
    lock.current = true; setPending(true); setNotice(null);
    const target = { vacancyId, invitationId: invitation?.id ?? "" };
    let reminded = false;
    try {
      if (operation === "send" || operation === "revoke") {
        const response = await (operation === "send" ? createInvitationAction({ vacancyId, participationId }) : revokeInvitationAction(target)).catch(() => unavailable);
        if (!response.ok) { fail(response, operation === "send" ? "No se creó la invitación" : "No se confirmó la revocación"); return; }
        context.adopt(response.data);
      } else {
        if (operation === "remind") {
          const response = await remindInvitationAction(target).catch(() => unavailable);
          if (!response.ok) { fail(response, "No se confirmó el recordatorio"); return; }
          reminded = true; context.adopt(response.data);
        }
        const response = await mintLinkAction(target).catch(() => unavailable);
        if (!response.ok) { fail(response, reminded ? "Recordatorio registrado · enlace no copiado" : "No se confirmó el enlace", reminded ? "El recordatorio quedó registrado. " : ""); return; }
        // Only this stack frame sees the returned token. Never render, log, cache,
        // put in React state, retain for retry, or include it in a notification.
        try { await navigator.clipboard.writeText(candidateUrl(window.location.origin, response.data.token)); }
        catch {
          if (live.current) {
            setNotice({ tone: "error", text: "No se copió el enlace", operation });
            notifyActionResult({ key: "psychometric-invitation", type: "error", title: "No se pudo copiar el enlace", description: `${reminded ? "El recordatorio quedó registrado. " : ""}El enlace anterior dejó de funcionar. Vuelve a Copiar enlace para generar otro; el avance se conserva.`, reference: { code: "clipboard_unavailable", at: new Date().toISOString() } });
          }
          return;
        }
      }
      if (!live.current) return;
      const title = operation === "send" ? "Invitación disponible" : operation === "revoke" ? "Invitación revocada" : operation === "remind" ? "Recordatorio registrado y enlace copiado" : "Enlace copiado";
      setNotice({ tone: "success", text: title, operation });
      notifyActionResult({ key: "psychometric-invitation", type: "success", title, description: operation === "send" ? "No se envió correo. Comparte el acceso con Copiar enlace." : operation === "revoke" ? "El acceso quedó cerrado. La persona no cambió de etapa." : "Comparte el enlace por tu canal habitual. El avance y la vigencia se conservaron." });
    } finally {
      lock.current = false;
      if (live.current) { setPending(false); setConfirmation(null); }
    }
  }
  return { confirmation, setConfirmation, pending, uncertain, checking, notice, execute,
    check: () => { if (context && !pending) { setChecking(true); context.retry(); } },
  };
}

type Session = ReturnType<typeof useInvitationManagement>;
export function InvitationPanel({ invitation, session, candidateName, stageName, vacancyId, locked }: { invitation?: Invitation; session: Session; candidateName: string; stageName: (id: string) => string; vacancyId: string; locked: boolean }) {
  const active = invitation?.status === "created" || invitation?.status === "in_progress";
  const selected = session.confirmation && operations[session.confirmation];
  const blocked = locked || session.pending || session.uncertain || session.checking;
  const status = <ActionStatusSlot>{session.notice && <ActionStatus id="psychometric-invitation-status" tone={session.notice.tone} text={session.notice.text} action={session.notice.configuration && <Link className="inline-flex min-h-10 items-center underline" href={`/empresa/vacantes/${vacancyId}/configuracion/psicometria`}>Configurar psicometría</Link>} />}</ActionStatusSlot>;
  function action(operation: Operation, primary = false) {
    const { label, icon: Icon } = operations[operation];
    return <Button type="button" variant={primary ? "default" : "outline"} className="min-h-10 shrink-0" disabled={blocked} aria-describedby="psychometric-invitation-status" onClick={() => session.setConfirmation(operation)}>{session.pending ? <Spinner aria-hidden="true" data-icon="inline-start" /> : <Icon aria-hidden="true" data-icon="inline-start" />}{label}</Button>;
  }
  return <div className="flex min-w-0 flex-col gap-3">
    {!invitation ? <Empty><EmptyHeader><EmptyMedia variant="icon"><ClipboardList aria-hidden="true" /></EmptyMedia><EmptyTitle><h2 className="text-xl font-semibold">Aún no hay evaluación</h2></EmptyTitle><EmptyDescription>Crea la invitación y comparte el enlace. Podrás seguir el avance desde aquí, sin mover a {candidateName} de etapa.</EmptyDescription></EmptyHeader><EmptyContent>{action("send", true)}<p className="text-xs text-muted-foreground">Se crea una invitación, no se envía correo. Después podrás copiar el enlace. Disponible aunque no haya una etapa automática.</p></EmptyContent></Empty> : <>
      <Item variant="outline" size="sm"><ItemContent><ItemTitle>Invitación · {statusLabels[invitation.status]}</ItemTitle><ItemDescription>{invitation.origin === "auto" ? "Automática" : "Manual"} · <MovementDate value={invitation.created_at} /> · {plural(invitation.reminder_count, "recordatorio", "recordatorios")}</ItemDescription></ItemContent><ItemActions>
        <DropdownMenu><DropdownMenuTrigger render={<Button type="button" variant="ghost" size="icon" className="size-10" aria-label={`Acciones de la invitación de ${candidateName}`} />}><Ellipsis aria-hidden="true" /></DropdownMenuTrigger><DropdownMenuContent align="end" className="w-48"><DropdownMenuGroup>{(["copy", "remind", "revoke"] as const).map(operation => { const { label, icon: Icon } = operations[operation]; return <DropdownMenuItem key={operation} className="min-h-10" variant={operation === "revoke" ? "destructive" : "default"} disabled={!active || blocked} onClick={() => session.setConfirmation(operation)}><Icon aria-hidden="true" />{label}</DropdownMenuItem>; })}</DropdownMenuGroup></DropdownMenuContent></DropdownMenu>
      </ItemActions></Item>
      {invitation.status !== "finished" && <header className="flex flex-col gap-3"><Badge variant={invitation.status === "in_progress" ? "info" : invitation.status === "created" ? "accent" : "neutral"} dot>{statusLabels[invitation.status]}</Badge><p className="text-sm text-muted-foreground">{invitation.status === "in_progress" && "En curso · "}{invitation.answered_count} de {invitation.total_count} respuestas. {active ? "El resultado estará disponible cuando termine." : "La persona ya no puede continuar con esta invitación."}</p>{invitation.status === "in_progress" && <Progress aria-label="Preguntas respondidas" value={invitation.answered_count} max={invitation.total_count} />}</header>}
      {!active && <p className="text-xs text-muted-foreground">El acceso está cerrado. Copiar enlace, recordar y revocar solo están disponibles para invitaciones activas.</p>}
      <Accordion><AccordionItem value="invitation"><AccordionTrigger>Detalles de la invitación</AccordionTrigger><AccordionContent><dl className="grid grid-cols-2 gap-x-4 gap-y-4 text-sm">
        <dt className="flex items-center gap-2 text-xs text-muted-foreground"><UserRound aria-hidden="true" className="size-4" />Creación</dt><dd className="text-right">{invitation.origin === "auto" ? `Automática${invitation.trigger_stage_id ? ` · al entrar a ${stageName(invitation.trigger_stage_id)}` : ""}` : `Manual${invitation.created_by ? ` · ${invitation.created_by.full_name}` : ""}`}</dd>
        <dt className="flex items-center gap-2 text-xs text-muted-foreground"><CalendarDays aria-hidden="true" className="size-4" />Invitación</dt><dd className="text-right"><MovementDate value={invitation.created_at} withTime /></dd>
        <dt className="flex items-center gap-2 text-xs text-muted-foreground"><Clock3 aria-hidden="true" className="size-4" />Vigencia</dt><dd className="text-right">Hasta <MovementDate value={invitation.expires_at} withTime /></dd>
        <dt className="flex items-center gap-2 text-xs text-muted-foreground"><Bell aria-hidden="true" className="size-4" />Último recordatorio</dt><dd className="text-right">{invitation.last_reminded_at ? <MovementDate value={invitation.last_reminded_at} withTime /> : "Sin recordatorios"}</dd>
      </dl><p className="text-xs text-muted-foreground">No se envió correo. Comparte el enlace por tu canal habitual. Crear otra invitación no duplica una que siga activa.</p></AccordionContent></AccordionItem></Accordion>
    </>}
    {status}
    {session.uncertain && <Button type="button" variant="outline" className="min-h-10 self-start" disabled={session.checking || session.pending} onClick={session.check}>{session.checking && <Spinner aria-hidden="true" data-icon="inline-start" />}Comprobar invitación</Button>}
    {selected && <ConfirmActionDialog open onOpenChange={open => { if (!open) session.setConfirmation(null); }} icon={selected.icon} title={`${selected.title} para ${candidateName}?`} description={selected.description} confirmLabel={selected.label} pendingLabel="Procesando…" pending={session.pending} confirmDisabled={locked || session.uncertain} tone={session.confirmation === "revoke" ? "destructive" : "default"} onConfirm={() => void session.execute()}>
      <dl className="grid grid-cols-2 gap-3 text-sm"><dt className="flex items-center gap-2 text-muted-foreground"><UserRound aria-hidden="true" className="size-4" />Persona</dt><dd>{candidateName}</dd>{invitation && <><dt className="flex items-center gap-2 text-muted-foreground"><ClipboardList aria-hidden="true" className="size-4" />Evaluación</dt><dd>{statusLabels[invitation.status]}</dd></>}</dl>
    </ConfirmActionDialog>}
  </div>;
}
