"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { CircleAlert, Ellipsis, LogOut, RefreshCw, UserRoundCog, UserRoundPlus, Users } from "lucide-react";
import { initials } from "@/features/pipeline-movement/pipeline-presentation";
import { plural } from "@/features/employer-vacancies/plural";
import { ConfirmActionDialog } from "@/components/feedback/confirm-action-dialog";
import { ActionBar, ActionStatus } from "@/components/feedback/action-status";
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

type Loaded = { team: Team; company: CompanyMembers; history: History };
type Dialog = { kind: "add" | "mode" | "leave" | "reassign" } | { kind: "remove" | "deadline"; member: Member };
export function TeamView({ client }: { client: TeamClient }) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [target, setTarget] = useState("");
  const [pending, setPending] = useState(false);
  const [morePending, setMorePending] = useState(false);
  const [historyFailed, setHistoryFailed] = useState(false);
  const [status, setStatus] = useState<{ tone: "info" | "error"; text: string } | null>(null);
  const [left, setLeft] = useState(false);
  const busy = useRef(false);
  useEffect(() => {
    let current = true;
    Promise.all([client.getTeam(), client.getCompanyMembers(), client.getHistory()]).then(([team, company, history]) => { if (current) { setLoaded({ team, company, history }); setFailed(false); } }).catch(() => { if (current) setFailed(true); });
    return () => { current = false; };
  }, [client, attempt]);
  const resultLine = status ? <ActionStatus id="team-action-status" tone={status.tone} text={status.text} /> : null;
  function open(next: Dialog) { setTarget(""); setDialog(next); }
  async function write(action: () => Promise<Team>, label: string, leaving = false) {
    if (busy.current) return;
    busy.current = true; setPending(true);
    try {
      const team = await action();
      setLoaded(previous => previous ? { ...previous, team } : previous);
      setDialog(null);
      if (leaving) setLeft(true);
      // Writes can move old events across cursor boundaries: always discard loaded pages.
      try {
        const history = await client.getHistory();
        setLoaded(previous => previous ? { ...previous, history } : previous); setHistoryFailed(false);
      } catch { setHistoryFailed(true); }
      const text = `${label} en esta vista.`;
      setStatus({ tone: "info", text });
      notifyActionResult({ key: "vacancy-team", type: "info", title: label, description: "El cambio vive en memoria y se pierde al recargar. No se guardó en el servidor." });
    } catch (error) {
      const code = error instanceof TeamError ? error.code : "unconfirmed_result";
      const descriptions: Record<string, string> = {
        use_reassign_responsible: "Para retirar al responsable, usa Reasignar responsable.",
        team_last_member: "El equipo debe conservar al menos una persona.",
        team_action_forbidden: "Esta cuenta no puede realizar la acción.",
        responsible_cannot_leave: "El owner debe asignar un reemplazo antes de tu salida.",
        team_mode_unchanged: "Elige un modo distinto al actual.",
      };
      const text = descriptions[code] ?? "El equipo no cambió. Revisa los datos e inténtalo de nuevo.";
      setStatus({ tone: "error", text });
      notifyActionResult({ key: "vacancy-team", type: "error", title: "No se cambió el equipo", description: text, reference: { code, status: error instanceof TeamError ? error.status : undefined, at: new Date().toISOString() } });
    } finally { busy.current = false; setPending(false); }
  }
  async function readHistory(more = false) {
    if (!loaded || morePending) return;
    setMorePending(true);
    try { const history = await client.getHistory(more ? loaded.history.next_cursor ?? undefined : undefined); setLoaded(previous => previous ? { ...previous, history: { ...history, items: more ? [...previous.history.items, ...history.items] : history.items } } : previous); setHistoryFailed(false); }
    catch { setHistoryFailed(true); }
    finally { setMorePending(false); }
  }
  if (failed) return <StateCard icon={CircleAlert} tone="error" title="No pudimos cargar el equipo" description="Tus datos no cambiaron. Reintenta para consultar el equipo y sus movimientos." primaryAction={{ label: "Reintentar", onClick: () => { setFailed(false); setAttempt(value => value + 1); } }} />;
  if (!loaded) return <TeamSkeleton />;
  if (left) return <StateCard icon={LogOut} tone="info" title="Saliste del equipo de esta vacante" description="Tu tramo terminó. El trabajo que hiciste sigue a tu nombre." primaryAction={{ label: "Ir a mis vacantes", href: "/empresa/vacantes" }} />;
  const { team, company, history } = loaded;
  const can = team.viewer.can;
  const close = () => { if (!pending) setDialog(null); };
  return <>
    <section className="flex flex-col gap-1"><h2 className="text-xl font-semibold">Equipo</h2><p className="max-w-prose text-sm text-muted-foreground">Comparte la meta y consulta quién trabajó en esta vacante.</p></section>
    <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <div className="flex min-w-0 flex-col gap-5">
        <Card><CardHeader><CardTitle><h3>Modo del equipo</h3></CardTitle><CardDescription>{team.mode === "with_responsible" ? "El responsable recibe el crédito directo; los colaboradores participan." : "El crédito de cada placement es de todo el equipo."}</CardDescription><CardAction><Badge variant="accent">{modeLabel[team.mode]}</Badge></CardAction></CardHeader>{can.change_mode && <CardFooter><Button type="button" variant="outline" onClick={() => open({ kind: "mode" })}>Cambiar modo</Button></CardFooter>}</Card>
        <Card id="current-team"><CardHeader className="border-b"><CardTitle><h3>Equipo actual</h3></CardTitle><CardDescription>El trabajo sigue a nombre de quien lo hizo.</CardDescription><CardAction><Badge variant="secondary">{plural(team.members.length, "persona", "personas")}</Badge></CardAction></CardHeader>
          <CardContent><ul className="flex flex-col gap-5">{team.members.map(member => <li key={member.assignment_id} className="flex min-w-0 items-start gap-3">
            {/* Avatar follows CandidateCard: no photo exists in the contract; always use its initials fallback. */}
            <Avatar className="size-10 shrink-0"><AvatarFallback>{initials(member.user.name)}</AvatarFallback></Avatar>
            <div className="flex min-w-0 flex-1 flex-col gap-1.5"><div className="flex flex-wrap items-center gap-2"><p className="break-words text-sm font-medium">{member.user.name}</p><Badge variant={member.function === "responsible" ? "accent" : "secondary"}>{functionLabel[member.function]}</Badge></div><p className="text-xs text-muted-foreground">{member.effective_deadline ? `Plazo ${formatDate(member.effective_deadline)} · ${sourceLabel[member.deadline_source].toLocaleLowerCase("es-MX")}` : "Sin plazo"}</p></div>
            {!!memberActions(can).length && <DropdownMenu><DropdownMenuTrigger render={<Button type="button" variant="ghost" size="icon" className="size-10" aria-label={`Acciones de ${member.user.name}`} aria-describedby={status ? "team-action-status" : undefined} />}><Ellipsis aria-hidden="true" /></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuGroup>{memberActions(can).map(action => <Fragment key={action}>{action === "remove" && <DropdownMenuSeparator />}<DropdownMenuItem className="min-h-10 whitespace-nowrap" variant={action === "remove" ? "destructive" : undefined} onClick={() => open({ kind: action, member })}>{memberActionLabel[action]}</DropdownMenuItem></Fragment>)}</DropdownMenuGroup></DropdownMenuContent></DropdownMenu>}
          </li>)}</ul></CardContent>
          {/* Team actions stay together, with only Add primary (reviewed T2b composition). Below sm they stack full width (§15). */}
          {(can.add_member || can.reassign_responsible || can.leave) && <CardFooter className="[&_[data-pf-action-bar-actions]]:shrink [&_[data-pf-action-bar-actions]]:min-w-0 max-sm:[&_[data-pf-action-bar]]:flex-col max-sm:[&_[data-pf-action-bar-actions]]:w-full max-sm:[&_[data-pf-action-bar-actions]]:flex-col max-sm:[&_[data-pf-action-bar-actions]>*]:w-full"><ActionBar status={resultLine}>
            {can.add_member && <Button type="button" className="min-h-10" aria-describedby={status ? "team-action-status" : undefined} onClick={() => open({ kind: "add" })}><UserRoundPlus aria-hidden="true" data-icon="inline-start" />Agregar al equipo</Button>}
            {can.reassign_responsible && <Button type="button" variant="outline" className="min-h-10" aria-describedby={status ? "team-action-status" : undefined} onClick={() => open({ kind: "reassign" })}><UserRoundCog aria-hidden="true" data-icon="inline-start" />Reasignar responsable</Button>}
            {can.leave && <Button type="button" variant="ghost" className="min-h-10" aria-describedby={status ? "team-action-status" : undefined} onClick={() => open({ kind: "leave" })}><LogOut aria-hidden="true" data-icon="inline-start" />Salir de la vacante</Button>}
          </ActionBar></CardFooter>}
        </Card>
      </div>
      <div className="flex min-w-0 flex-col gap-4">{historyFailed ? <StateCard icon={RefreshCw} tone="error" title="No pudimos cargar los movimientos" description="El equipo actual sigue disponible. Reintenta esta consulta sin cambiar datos." primaryAction={{ label: "Reintentar movimientos", onClick: () => void readHistory() }} /> : <TeamHistory history={history} pending={morePending} onMore={() => void readHistory(true)} />}</div>
    </div>
    {dialog?.kind === "reassign" && <ReassignDialog team={team} company={company} calendar={client.calendar} snapshot={client.snapshot} pending={pending} onClose={close} onConfirm={body => void write(() => client.reassign(body), "Responsable reasignado")} />}
    {dialog?.kind === "add" && can.add_member && <ConfirmActionDialog open onOpenChange={open => { if (!open) close(); }} onConfirm={() => void write(() => client.addMember({ user_id: target, recruiter_deadline: null }), "Persona agregada al equipo")} icon={UserRoundPlus} title="Agregar al equipo" description="Se abre un nuevo tramo. La persona podrá trabajar en esta vacante y ver sus movimientos." confirmLabel="Agregar" pending={pending} confirmDisabled={!target}><FieldGroup><PersonField id="add-target" label="Persona de la empresa" members={availableMembers(team, company)} value={target} onChange={setTarget} /></FieldGroup><p className="text-sm text-muted-foreground">Sin plazo propio, se usa la fecha compromiso: {formatDate(client.snapshot.delivery.commitment_date)}.</p></ConfirmActionDialog>}
    {dialog?.kind === "mode" && can.change_mode && <ConfirmActionDialog open onOpenChange={open => { if (!open) close(); }} onConfirm={() => void write(() => client.changeMode({ mode: team.mode === "shared" ? "with_responsible" : "shared", ...(team.mode === "shared" ? { responsible_user_id: target } : {}) }), "Modo del equipo cambiado")} icon={Users} title={`Cambiar a ${modeLabel[team.mode === "shared" ? "with_responsible" : "shared"].toLowerCase()}`} description="Los tramos y sus plazos continúan. El cambio solo afecta créditos futuros." confirmLabel="Cambiar modo" pending={pending} confirmDisabled={team.mode === "shared" && !target}><FieldGroup><ChoiceField id="next-mode" label="Nuevo modo" items={[{ value: team.mode === "shared" ? "with_responsible" : "shared", label: modeLabel[team.mode === "shared" ? "with_responsible" : "shared"] }]} value={team.mode === "shared" ? "with_responsible" : "shared"} onChange={() => {}} />{team.mode === "shared" && <PersonField id="mode-responsible" label="Responsable" members={company.members.filter(person => team.members.some(member => member.user.id === person.user.id))} value={target} onChange={setTarget} />}</FieldGroup></ConfirmActionDialog>}
    {dialog?.kind === "remove" && can.remove_member && <ConfirmActionDialog open onOpenChange={open => { if (!open) close(); }} onConfirm={() => void write(() => client.removeMember(dialog.member.user.id), "Persona retirada del equipo")} icon={LogOut} title={`Quitar a ${dialog.member.user.name}`} description="Se cierra su tramo y pierde acceso a esta vacante. Su trabajo sigue a su nombre." confirmLabel="Quitar del equipo" tone="destructive" pending={pending}><p className="text-sm">Plazo al salir: {formatDate(dialog.member.effective_deadline)} · {sourceLabel[dialog.member.deadline_source]}</p></ConfirmActionDialog>}
    {dialog?.kind === "leave" && can.leave && <ConfirmActionDialog open onOpenChange={open => { if (!open) close(); }} onConfirm={() => void write(() => client.leave(), "Saliste del equipo", true)} icon={LogOut} title="Salir de la vacante" description="Pierdes el acceso a esta vacante. Tu trabajo queda atribuido a tu tramo." confirmLabel="Salir de la vacante" tone="destructive" pending={pending} />}
    {dialog?.kind === "deadline" && can.edit_deadline && <DeadlineDialog member={dialog.member} calendar={client.calendar} commitmentDate={client.snapshot.delivery.commitment_date} pending={pending} onClose={close} onConfirm={next => void write(() => client.editDeadline(dialog.member.user.id, next), "Plazo actualizado")} />}
  </>;
}
