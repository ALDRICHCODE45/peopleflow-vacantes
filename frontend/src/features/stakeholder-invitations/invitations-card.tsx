"use client";

import * as React from "react";
import { Ban, Eye, Link2, MailX, TriangleAlert } from "lucide-react";
import { ActionStatus, ActionStatusSlot } from "@/components/feedback/action-status";
import { ConfirmActionDialog } from "@/components/feedback/confirm-action-dialog";
import { notifyActionResult } from "@/components/feedback/notify";
import { SectionEmpty } from "@/components/feedback/state-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { createStakeholderInvitationAction, listStakeholderInvitationsAction, revokeStakeholderInvitationAction } from "./actions";
import { formatDay, formatInstant, formatRemaining } from "./format";
import { InviteLinkDialog } from "./invite-link-dialog";
import { MAX_PENDING_INVITATIONS, creatorName, invitationUrl, type CreatedInvitation, type InvitationFailure, type ListInvitationsResult, type PendingInvitation } from "./model";

type Member = { user: { id: string; full_name: string } | null };
type Props = { members: readonly Member[]; stakeholderCount: number };
type Status = { tone: "success" | "error"; text: string } | null;

const UNCERTAIN: InvitationFailure["reason"][] = ["server_error", "no_response", "unrecognized_response"];
const createFailure = (failure: InvitationFailure) => failure.reason === "limit_reached"
  ? "Llegaste al máximo de 20 invitaciones pendientes. Revoca alguna para crear otra."
  : failure.reason === "forbidden" ? "Solo la persona dueña de la cuenta puede crear invitaciones."
    : failure.reason === "unauthenticated" ? "Tu sesión expiró. Inicia sesión para crear la invitación."
      : "No pudimos confirmar si se creó el enlace. Si aparece una invitación nueva en la lista, revócala y crea otra.";
const revokeFailure = (failure: InvitationFailure) => failure.reason === "forbidden"
  ? "Solo la persona dueña de la cuenta puede revocar invitaciones. El enlace sigue activo."
  : failure.reason === "unauthenticated" ? "Tu sesión expiró. Inicia sesión para revocar la invitación."
    : "No pudimos confirmar la revocación. Revisa la lista: si la invitación sigue ahí, vuelve a revocarla.";

/**
 * Owner-only «Stakeholders» card under Equipo (artboard 04): create a copyable single-use link, list pending
 * invitations by creation date (the API never returns a token again) and revoke them. Removing a stakeholder stays in
 * the members list «Acciones».
 */
export function StakeholderInvitationsCard({ members, stakeholderCount }: Props) {
  const [list, setList] = React.useState<ListInvitationsResult | null>(null);
  const [created, setCreated] = React.useState<CreatedInvitation | null>(null);
  const [fresh, setFresh] = React.useState<string | null>(null);
  const [revoking, setRevoking] = React.useState<PendingInvitation | null>(null);
  const [pending, setPending] = React.useState<"create" | "revoke" | null>(null);
  const [status, setStatus] = React.useState<Status>(null);
  const lock = React.useRef(false);
  const sequence = React.useRef(0);
  const active = React.useRef(true);
  const statusId = React.useId();
  const limitId = React.useId();

  const refresh = React.useCallback(async () => {
    const request = ++sequence.current;
    const result = await listStakeholderInvitationsAction().catch((): ListInvitationsResult => ({ ok: false, reason: "no_response", reference: {} }));
    if (active.current && sequence.current === request) setList(result);
  }, []);
  React.useEffect(() => {
    active.current = true;
    const reads = sequence;
    void refresh();
    // Unmounting invalidates any read still in flight.
    return () => { active.current = false; reads.current++; };
  }, [refresh]);

  async function create() {
    if (lock.current) return;
    lock.current = true; setPending("create"); setStatus(null);
    const result = await createStakeholderInvitationAction().catch((): InvitationFailure => ({ ok: false, reason: "no_response", reference: {} }));
    if (!active.current) return;
    if (result.ok) {
      setCreated(result.invitation);
      setFresh(result.invitation.id);
      notifyActionResult({ key: "stakeholder-invitation", type: "success", title: "Enlace de invitación creado", description: "Cópialo ahora: no se vuelve a mostrar." });
    } else {
      const text = createFailure(result);
      setStatus({ tone: "error", text });
      notifyActionResult({ key: "stakeholder-invitation", type: "error", title: "No se creó el enlace", description: text, reference: { ...result.reference, at: new Date().toISOString() } });
    }
    // Success, the limit and an uncertain outcome all change what is pending: read it once, never retry the write.
    await refresh();
    lock.current = false; if (active.current) setPending(null);
  }

  async function revoke() {
    if (!revoking || lock.current) return;
    lock.current = true; setPending("revoke"); setStatus(null);
    const result = await revokeStakeholderInvitationAction(revoking.id).catch((): InvitationFailure => ({ ok: false, reason: "no_response", reference: {} }));
    if (!active.current) return;
    if (result.ok) {
      setStatus({ tone: "success", text: "Invitación revocada" });
      notifyActionResult({ key: "stakeholder-invitation", type: "success", title: "Invitación revocada", description: "El enlace ya no funciona." });
    } else {
      setStatus({ tone: "error", text: "No se revocó la invitación" });
      notifyActionResult({ key: "stakeholder-invitation", type: "error", title: "No se revocó la invitación", description: revokeFailure(result), reference: { ...result.reference, at: new Date().toISOString() } });
    }
    setRevoking(null);
    if (result.ok || UNCERTAIN.includes(result.reason)) await refresh();
    lock.current = false; if (active.current) setPending(null);
  }

  const items = list?.ok ? list.items : [];
  const atLimit = items.length >= MAX_PENDING_INVITATIONS;
  const empty = list?.ok === true && items.length === 0 && stakeholderCount === 0;
  const createButton = (attributes: { describedBy?: string } = {}) => <Button type="button" className="min-h-10" disabled={pending !== null || atLimit}
    aria-describedby={[attributes.describedBy, status ? statusId : undefined].filter(Boolean).join(" ") || undefined} onClick={() => void create()}>
    {pending === "create" ? <Spinner data-icon="inline-start" aria-hidden="true" /> : <Link2 data-icon="inline-start" aria-hidden="true" />}
    {pending === "create" ? "Creando enlace…" : "Crear enlace de invitación"}
  </Button>;

  return <Card data-pf-stakeholder-invitations="">
    <CardHeader className="border-b">
      <div className="flex items-start gap-3">
        <span aria-hidden="true" className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary"><Eye className="size-5" /></span>
        <div className="flex min-w-0 flex-col gap-1">
          <CardTitle><h2>Stakeholders</h2></CardTitle>
          <CardDescription>Solo ven Métricas, incluidos nombres de candidatos en el detalle auditado. No trabajan vacantes ni reciben créditos.</CardDescription>
        </div>
      </div>
      {list?.ok && !empty && <CardAction>{createButton({ describedBy: atLimit ? limitId : undefined })}</CardAction>}
    </CardHeader>
    <CardContent className="flex flex-col gap-3">
      {list === null ? <div aria-busy="true" className="flex flex-col gap-3"><span role="status" className="sr-only">Cargando invitaciones</span>
        {[0, 1].map(key => <Skeleton key={key} aria-hidden="true" className="h-10 w-full" />)}</div>
        : !list.ok ? <div className="flex flex-wrap items-center gap-3">
          <ActionStatus id={`${statusId}-read`} tone="error" text="No pudimos cargar las invitaciones. Es seguro reintentar." />
          <Button type="button" variant="outline" className="min-h-10" onClick={() => { setList(null); void refresh(); }}>Reintentar</Button>
        </div>
          : empty ? <SectionEmpty icon={Eye} tone="info" title="Aún no hay stakeholders"
            description="Un stakeholder ve las métricas de la empresa en solo lectura, por ejemplo un director. Crea un enlace y envíaselo." />
            : <>
              {atLimit && <p id={limitId} className="flex gap-2 text-sm"><TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-status-review" /><span>Tienes 20 invitaciones pendientes, el máximo. Revoca alguna que ya no uses para crear otra.</span></p>}
              {items.length === 0 ? <SectionEmpty icon={MailX} tone="empty" title="No hay invitaciones pendientes"
                description="Los enlaces que crees aparecen aquí hasta que alguien los use, venzan o los revoques." />
                : <Table aria-labelledby={`${statusId}-title`}>
                  <TableCaption className="mt-0 mb-2 text-left text-foreground caption-top">
                    <span id={`${statusId}-title`} className="font-semibold">Invitaciones pendientes</span> <span className="text-muted-foreground tabular-nums">{items.length} de {MAX_PENDING_INVITATIONS}</span>
                  </TableCaption>
                  <TableHeader><TableRow><TableHead>Invitación</TableHead><TableHead>Creada por</TableHead><TableHead>Vence</TableHead><TableHead><span className="sr-only">Acciones</span></TableHead></TableRow></TableHeader>
                  <TableBody className="tabular-nums">{items.map(item => <TableRow key={item.id}>
                    <TableCell><span className="flex flex-wrap items-center gap-2">{formatInstant(item.created_at)}{item.id === fresh && <Badge variant="accent">Nueva</Badge>}</span></TableCell>
                    <TableCell>{creatorName(item.created_by, members)}</TableCell>
                    <TableCell><span className="block">{formatDay(item.expires_at)}</span><span className="block text-xs text-muted-foreground">{formatRemaining(item.expires_at)}</span></TableCell>
                    <TableCell className="text-right"><Button type="button" variant="ghost" className="min-h-10" disabled={pending !== null}
                      aria-label={`Revocar invitación del ${formatInstant(item.created_at)}`} onClick={() => setRevoking(item)}><Ban data-icon="inline-start" aria-hidden="true" />Revocar</Button></TableCell>
                  </TableRow>)}</TableBody>
                </Table>}
            </>}
      {empty && <div className="flex justify-center">{createButton()}</div>}
      <ActionStatusSlot>{status && <ActionStatus id={statusId} tone={status.tone} text={status.text} />}</ActionStatusSlot>
    </CardContent>
    {list?.ok && !empty && <CardFooter className="border-t">
      <p className="text-xs text-muted-foreground">Por seguridad el enlace no se vuelve a mostrar. Si se perdió, revoca la invitación y crea otra. Quitar a un stakeholder se hace desde «Acciones» en la lista de miembros; para cambiarle el rol hay que quitarlo e invitarlo de nuevo.</p>
    </CardFooter>}
    {created && <InviteLinkDialog url={invitationUrl(window.location.origin, created.url_token)} expiresAt={created.expires_at} onClose={() => setCreated(null)} />}
    <ConfirmActionDialog open={revoking !== null} onOpenChange={open => { if (!open && pending !== "revoke") setRevoking(null); }} onConfirm={() => void revoke()}
      icon={Ban} tone="destructive" title={revoking ? `¿Revocar la invitación del ${formatInstant(revoking.created_at)}?` : "¿Revocar la invitación?"}
      description="El enlace deja de funcionar de inmediato. Si la persona todavía no se une, tendrás que enviarle uno nuevo."
      confirmLabel="Revocar invitación" pendingLabel="Revocando…" pending={pending === "revoke"} />
  </Card>;
}
