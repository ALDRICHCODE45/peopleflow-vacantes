"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { CircleAlert, Ellipsis, LogOut, RefreshCw, UserRoundCog, UserRoundPlus, Users } from "lucide-react";
import { initials } from "@/features/pipeline-movement/pipeline-presentation";
import { plural } from "@/features/employer-vacancies/plural";
import { ConfirmActionDialog } from "@/components/feedback/confirm-action-dialog";
import { ActionStatusSlot, ActionStatus } from "@/components/feedback/action-status";
import { notifyActionResult } from "@/components/feedback/notify";
import { StateCard } from "@/components/feedback/state-card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { FieldGroup } from "@/components/ui/field";
import { TeamError, type TeamClient } from "./client";
import { ChoiceField, PersonField } from "./controls";
import { TeamHistory } from "./history";
import { TeamSkeleton } from "./loading";
import { availableMembers, formatDate, functionLabel, memberActionLabel, memberActions, modeLabel, sourceLabel, type CompanyMembers, type History, type Member, type Team } from "./model";
import { DeadlineDialog } from "./deadline-dialog";
import { ReassignDialog } from "./reassign-dialog";
import { TeamAccessEnded } from "./access-ended";
import { DraftEditErrorState } from "@/features/jobs/drafts/reopen/error-state";

type Loaded = { team: Team; company: CompanyMembers; history: History };
type Dialog = { kind: "add" | "mode" | "leave" | "reassign" } | { kind: "remove" | "deadline"; member: Member };
export function TeamView({ client, writesAvailable = true }: { client: TeamClient; writesAvailable?: boolean }) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [failed, setFailed] = useState<TeamError | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [target, setTarget] = useState("");
  const [pending, setPending] = useState(false);
  const [retry, setRetry] = useState(false);
  const retryAction = useRef<(() => Promise<Team>) | null>(null);
  const [morePending, setMorePending] = useState(false);
  const [historyFailed, setHistoryFailed] = useState(false);
  const [status, setStatus] = useState<{ tone: "info" | "error"; text: string } | null>(null);
  const [left, setLeft] = useState(false);
  const busy = useRef(false);
  useEffect(() => {
    let current = true;
    Promise.all([client.getTeam(), client.getCompanyMembers(), client.getHistory()]).then(([team, company, history]) => { if (current) { setLoaded({ team, company, history }); setFailed(null); } }).catch(error => { if (current) setFailed(error instanceof TeamError ? error : new TeamError("read_failed")); });
    return () => { current = false; };
  }, [client, attempt]);
  const resultLine = status ? <ActionStatus id="team-action-status" tone={status.tone} text={status.text} /> : null;
  function open(next: Dialog) { client.beginAttempt?.(); retryAction.current = null; setRetry(false); setStatus(null); setTarget(""); setDialog(next); }
  async function write(action: () => Promise<Team>, label: string, leaving = false) {
    if (!writesAvailable || busy.current) return;
    busy.current = true; setPending(true);
    try {
      const team = await (retryAction.current ?? action)();
      retryAction.current = null; setRetry(false);
      setLoaded(previous => previous ? { ...previous, team } : previous);
      setDialog(null);
      if (leaving) setLeft(true);
      // Writes can move old events across cursor boundaries: always discard loaded pages.
      try {
        const history = await client.getHistory();
        setLoaded(previous => previous ? { ...previous, history } : previous); setHistoryFailed(false);
      } catch { setHistoryFailed(true); }
      const text = client.persisted ? `${label}.` : `${label} en esta vista.`;
      setStatus({ tone: "info", text });
      notifyActionResult({ key: "vacancy-team", type: client.persisted ? "success" : "info", title: label, description: client.persisted ? "El cambio se guardó." : "El cambio vive en memoria y se pierde al recargar. No se guardó en el servidor." });
    } catch (error) {
      const code = error instanceof TeamError ? error.code : "unconfirmed_result";
      const httpStatus = error instanceof TeamError ? error.status : 0;
      const uncertain = !(httpStatus >= 400 && httpStatus < 500) || httpStatus === 428;
      retryAction.current = uncertain ? retryAction.current ?? action : null; setRetry(uncertain);
      if ((httpStatus === 404 && code !== "team_member_not_found") || httpStatus === 401) setFailed(error instanceof TeamError ? error : new TeamError(code));
      let reloadFailed = false;
      if (httpStatus === 412 || httpStatus === 403) {
        try {
          const team = await client.getTeam();
          setLoaded(previous => previous ? { ...previous, team } : previous);
          if (httpStatus === 412) {
            const history = await client.getHistory();
            setLoaded(previous => previous ? { ...previous, history } : previous); setHistoryFailed(false);
          }
        } catch (reloadError) {
          reloadFailed = true;
          setFailed(reloadError instanceof TeamError ? reloadError : new TeamError("read_failed"));
        }
      }
      const descriptions: Record<string, string> = {
        use_reassign_responsible: "Para retirar al responsable, usa Reasignar responsable.",
        team_last_member: "El equipo debe conservar al menos una persona.",
        team_action_forbidden: "No tienes permiso para esta acción.",
        team_version_conflict: "El equipo cambió mientras lo editabas. Recargamos los datos; revisa y vuelve a intentarlo.",
        responsible_cannot_leave: "El dueño debe asignar un reemplazo antes de tu salida.",
        team_mode_unchanged: "Elige un modo distinto al actual.",
        team_member_already_active: "Esta persona ya está en el equipo.",
        not_company_member: "Esta persona ya no pertenece a la empresa.",
        reassign_target_is_responsible: "Esta persona ya es responsable de la vacante.",
        reassignment_note_required: "Escribe una nota para el motivo Otro.",
        responsible_not_on_team: "El responsable debe ser una persona del equipo actual.",
        recruiter_deadline_not_applicable: "Esta persona ya tiene un plazo. Para cambiarlo, usa Editar plazo.",
        responsible_not_applicable: "Un equipo sin responsable no puede recibir un responsable.",
        team_mode_mismatch: "El modo del equipo cambió. Recarga antes de reasignar.",
        team_member_not_found: "Esta persona ya no está en el equipo.",
      };
      const text = reloadFailed ? "No pudimos recargar los datos del equipo. Reintenta la consulta." : uncertain ? "No pudimos confirmar el cambio. Vuelve a confirmar para reintentar el mismo intento de forma segura." : descriptions[code] ?? "No se pudo cambiar el equipo. Revisa los datos e inténtalo de nuevo.";
      setStatus({ tone: "error", text });
      notifyActionResult({ key: "vacancy-team", type: "error", title: uncertain ? "Cambio sin confirmar" : "No se cambió el equipo", description: text, reference: { code, status: error instanceof TeamError ? error.status : undefined, at: new Date().toISOString() } });
    } finally { busy.current = false; setPending(false); }
  }
  async function readHistory(more = false) {
    if (!loaded || morePending) return;
    setMorePending(true);
    try { const history = await client.getHistory(more ? loaded.history.next_cursor ?? undefined : undefined); setLoaded(previous => previous ? { ...previous, history: { ...history, items: more ? [...previous.history.items, ...history.items] : history.items } } : previous); setHistoryFailed(false); }
    catch (error) {
      if (error instanceof TeamError && (error.status === 401 || error.status === 404)) setFailed(error);
      else setHistoryFailed(true);
    }
    finally { setMorePending(false); }
  }
  if (failed?.code === "team_access_ended") return <TeamAccessEnded />;
  if (failed?.status === 404 || failed?.status === 401) return <DraftEditErrorState reason={failed.status === 401 ? "unauthenticated" : "not_found"} onRetry={() => { setFailed(null); setAttempt(value => value + 1); }} />;
  if (failed) return <StateCard icon={CircleAlert} tone="error" title="No pudimos cargar el equipo" description="Tus datos no cambiaron. Reintenta para consultar el equipo y sus movimientos." primaryAction={{ label: "Reintentar", onClick: () => { setFailed(null); setAttempt(value => value + 1); } }} />;
  if (!loaded) return <TeamSkeleton />;
  if (left) return <StateCard icon={LogOut} tone="info" title="Saliste del equipo de esta vacante" description="Tu tramo terminó. El trabajo que hiciste sigue a tu nombre." primaryAction={{ label: "Ir a mis vacantes", href: "/empresa/vacantes" }} />;
  const { team, company, history } = loaded;
  const can = team.viewer.can;
  const close = () => { if (!pending) setDialog(null); };
  return <>
    <section className="flex flex-col gap-1"><h2 className="text-xl font-semibold">Equipo</h2><p className="max-w-prose text-sm text-muted-foreground">Comparte la meta y consulta quién trabajó en esta vacante.</p></section>
    <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <div className="flex min-w-0 flex-col gap-5">
        <Card><CardHeader><CardTitle><h3>Modo del equipo</h3></CardTitle><CardDescription>{team.mode === "with_responsible" ? "El responsable recibe el crédito directo; los colaboradores participan." : "El crédito de cada placement es de todo el equipo."}</CardDescription><CardAction><Badge variant="accent">{modeLabel[team.mode]}</Badge></CardAction></CardHeader>{writesAvailable && can.change_mode && <CardFooter><Button type="button" variant="outline" onClick={() => open({ kind: "mode" })}>Cambiar modo</Button></CardFooter>}</Card>
        <Card id="current-team"><CardHeader className="border-b"><CardTitle><h3>Equipo actual</h3></CardTitle><CardDescription>El trabajo sigue a nombre de quien lo hizo.</CardDescription><CardAction><Badge variant="secondary">{plural(team.members.length, "persona", "personas")}</Badge></CardAction></CardHeader>
          <CardContent><ul className="flex flex-col gap-5">{team.members.map(member => <li key={member.assignment_id} className="flex min-w-0 items-start gap-3">
            {/* Avatar follows CandidateCard: no photo exists in the contract; always use its initials fallback. */}
            <Avatar className="size-10 shrink-0"><AvatarFallback>{initials(member.user.name)}</AvatarFallback></Avatar>
            <div className="flex min-w-0 flex-1 flex-col gap-1.5"><div className="flex flex-wrap items-center gap-2"><p className="break-words text-sm font-medium">{member.user.name}</p><Badge variant={member.function === "responsible" ? "accent" : "secondary"}>{functionLabel[member.function]}</Badge></div><p className="text-xs text-muted-foreground">{member.effective_deadline ? `Plazo ${formatDate(member.effective_deadline)} · ${sourceLabel[member.deadline_source].toLocaleLowerCase("es-MX")}` : "Sin plazo"}</p></div>
            {writesAvailable && !!memberActions(can).length && <DropdownMenu><DropdownMenuTrigger render={<Button type="button" variant="ghost" size="icon" className="size-10" aria-label={`Acciones de ${member.user.name}`} aria-describedby={status ? "team-action-status" : undefined} />}><Ellipsis aria-hidden="true" /></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuGroup>{memberActions(can).map(action => <Fragment key={action}>{action === "remove" && <DropdownMenuSeparator />}<DropdownMenuItem className="min-h-10 whitespace-nowrap" variant={action === "remove" ? "destructive" : undefined} onClick={() => open({ kind: action, member })}>{memberActionLabel[action]}</DropdownMenuItem></Fragment>)}</DropdownMenuGroup></DropdownMenuContent></DropdownMenu>}
          </li>)}</ul></CardContent>
          {/* Team actions stay together, with only Add primary (reviewed T2b composition). Below sm they stack full width (§15). */}
          {/* Requested exception to §12: reserve a separate full-width status row so three actions cannot overlap it. */}
          {writesAvailable && (can.add_member || can.reassign_responsible || can.leave) && <CardFooter><div data-pf-action-bar="" className="flex w-full flex-col items-start gap-3">
            <div className="w-full min-w-0"><ActionStatusSlot>{resultLine}</ActionStatusSlot></div>
            <div data-pf-action-bar-actions="" className="flex min-w-0 flex-wrap justify-end gap-2 max-sm:w-full max-sm:flex-col max-sm:[&>*]:w-full">
            {can.add_member && <Button type="button" className="min-h-10" aria-describedby={status ? "team-action-status" : undefined} onClick={() => open({ kind: "add" })}><UserRoundPlus aria-hidden="true" data-icon="inline-start" />Agregar al equipo</Button>}
            {can.reassign_responsible && <Button type="button" variant="outline" className="min-h-10" aria-describedby={status ? "team-action-status" : undefined} onClick={() => open({ kind: "reassign" })}><UserRoundCog aria-hidden="true" data-icon="inline-start" />Reasignar responsable</Button>}
            {can.leave && <Button type="button" variant="ghost" className="min-h-10" aria-describedby={status ? "team-action-status" : undefined} onClick={() => open({ kind: "leave" })}><LogOut aria-hidden="true" data-icon="inline-start" />Salir de la vacante</Button>}
          </div></div></CardFooter>}
        </Card>
      </div>
      <div className="flex min-w-0 flex-col gap-4">{historyFailed ? <StateCard icon={RefreshCw} tone="error" title="No pudimos cargar los movimientos" description="El equipo actual sigue disponible. Reintenta esta consulta sin cambiar datos." primaryAction={{ label: "Reintentar movimientos", onClick: () => void readHistory() }} /> : <TeamHistory history={history} pending={morePending} onMore={() => void readHistory(true)} />}</div>
    </div>
    {dialog?.kind === "reassign" && <ReassignDialog team={team} company={company} calendar={client.calendar} commitmentDate={client.commitmentDate ?? null} snapshot={client.snapshot} pending={pending} frozen={retry} onClose={close} onConfirm={body => void write(() => client.reassign(body), "Responsable reasignado")} />}
    {dialog?.kind === "add" && can.add_member && <ConfirmActionDialog open onOpenChange={open => { if (!open) close(); }} onConfirm={() => void write(() => client.addMember({ user_id: target, recruiter_deadline: null }), "Persona agregada al equipo")} icon={UserRoundPlus} title="Agregar al equipo" description="Se abre un nuevo tramo. La persona podrá trabajar en esta vacante y ver sus movimientos." confirmLabel="Agregar" pending={pending} confirmDisabled={!target}><FieldGroup inert={pending || retry}><PersonField id="add-target" label="Persona de la empresa" members={availableMembers(team, company)} value={target} onChange={setTarget} /></FieldGroup><p className="text-sm text-muted-foreground">{client.commitmentDate ? `Sin plazo propio, se usa la fecha compromiso: ${formatDate(client.commitmentDate)}.` : "Sin plazo propio. Esta vacante todavía no tiene fecha compromiso."}</p></ConfirmActionDialog>}
    {dialog?.kind === "mode" && can.change_mode && <ConfirmActionDialog open onOpenChange={open => { if (!open) close(); }} onConfirm={() => void write(() => client.changeMode({ mode: team.mode === "shared" ? "with_responsible" : "shared", ...(team.mode === "shared" ? { responsible_user_id: target } : {}) }), "Modo del equipo cambiado")} icon={Users} title={`Cambiar a «${modeLabel[team.mode === "shared" ? "with_responsible" : "shared"]}»`} description="Los tramos y sus plazos continúan. El cambio solo afecta créditos futuros." confirmLabel="Cambiar modo" pending={pending} confirmDisabled={team.mode === "shared" && !target}><FieldGroup inert={pending || retry}><ChoiceField id="next-mode" label="Nuevo modo" items={[{ value: team.mode === "shared" ? "with_responsible" : "shared", label: modeLabel[team.mode === "shared" ? "with_responsible" : "shared"] }]} value={team.mode === "shared" ? "with_responsible" : "shared"} onChange={() => {}} />{team.mode === "shared" && <PersonField id="mode-responsible" label="Responsable" members={company.members.filter(person => team.members.some(member => member.user.id === person.user.id))} value={target} onChange={setTarget} />}</FieldGroup></ConfirmActionDialog>}
    {dialog?.kind === "remove" && can.remove_member && <ConfirmActionDialog open onOpenChange={open => { if (!open) close(); }} onConfirm={() => void write(() => client.removeMember(dialog.member.user.id), "Persona retirada del equipo")} icon={LogOut} title={`Quitar a ${dialog.member.user.name}`} description="Se cierra su tramo y pierde acceso a esta vacante. Su trabajo sigue a su nombre." confirmLabel="Quitar del equipo" tone="destructive" pending={pending}><p className="text-sm">Plazo al salir: {formatDate(dialog.member.effective_deadline)} · {sourceLabel[dialog.member.deadline_source]}</p></ConfirmActionDialog>}
    {dialog?.kind === "leave" && can.leave && <ConfirmActionDialog open onOpenChange={open => { if (!open) close(); }} onConfirm={() => void write(() => client.leave(), "Saliste del equipo", true)} icon={LogOut} title="Salir de la vacante" description="Pierdes el acceso a esta vacante. Tu trabajo queda atribuido a tu tramo." confirmLabel="Salir de la vacante" tone="destructive" pending={pending} />}
    {dialog?.kind === "deadline" && can.edit_deadline && <DeadlineDialog member={dialog.member} calendar={client.calendar} commitmentDate={client.commitmentDate ?? null} pending={pending} frozen={retry} onClose={close} onConfirm={next => void write(() => client.editDeadline(dialog.member.user.id, next), "Plazo actualizado")} />}
  </>;
}
