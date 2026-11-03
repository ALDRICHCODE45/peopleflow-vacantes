"use client";

import * as React from "react";
import { CircleAlert, LogIn, UserRoundCog, UserRoundMinus, Users } from "lucide-react";
import { ActionStatus, ActionStatusSlot } from "@/components/feedback/action-status";
import { ConfirmActionDialog } from "@/components/feedback/confirm-action-dialog";
import { StateCard } from "@/components/feedback/state-card";
import { notifyActionResult } from "@/components/feedback/notify";
import { useIdentity } from "@/features/identity/identity-session";
import { useCompanyMembership } from "@/features/employer-company/use-company-membership";
import { usePortfolioDrafts } from "@/features/employer-vacancies/use-portfolio-drafts";
import { changeTeamRoleAction, removeTeamMemberAction, type TeamFailure } from "./actions";
import { memberName, memberRowActions, type CompanyMember, type MemberRowAction } from "./members-model";
import type { TeamMemberRole } from "./model";
import { useTeamMembers } from "./use-team-members";
import { TeamWorkspace } from "./team-workspace";
import { createOffboardFixtureClient, offboardPrototypeEnabled, prototypeMembers, OffboardError, type OffboardBody, type OffboardFixtureClient, type OffboardPreview, type OffboardScenario } from "./offboard-client";
import { OffboardDialog } from "./offboard-dialog";

const messages: Record<TeamFailure["reason"], { title: string; description: string }> = {
  unauthenticated: { title: "Tu sesión expiró", description: "Inicia sesión para consultar o administrar el equipo." },
  not_member: { title: "No perteneces a esta empresa", description: "No encontramos tu acceso al equipo. Revisa la configuración de tu empresa o vuelve a comprobarlo." },
  forbidden: { title: "No tienes permiso para esta acción", description: "Solo una cuenta con rol de dueño puede administrar el equipo. Tus datos no cambiaron." },
  invalid_request: { title: "No pudimos completar la acción", description: "Actualiza la lista antes de volver a intentarlo." },
  last_owner: { title: "La empresa debe conservar al menos un dueño", description: "Asigna a otra persona como dueña antes de cambiar este rol o quitarla del equipo." },
  server_error: { title: "No pudimos cargar el equipo", description: "El servidor tuvo un problema. Es seguro reintentar esta consulta; no cambia los datos del equipo." },
  no_response: { title: "No pudimos cargar el equipo", description: "No hubo respuesta del servidor. Puedes reintentar la consulta sin cambiar los datos del equipo." },
  unrecognized_response: { title: "No pudimos cargar el equipo", description: "No pudimos leer la respuesta del servidor. Puedes volver a consultar sin cambiar los datos del equipo." },
};
function TeamReadFailure({ failure, retry }: { failure: TeamFailure; retry: () => void }) {
  const message = messages[failure.reason];
  return <StateCard icon={failure.reason === "unauthenticated" ? LogIn : CircleAlert} tone="error" title={message.title} description={message.description}
    primaryAction={{ label: "Reintentar", onClick: retry }}
    secondaryAction={failure.reason === "unauthenticated" ? { label: "Iniciar sesión", href: "/empresa/login" } : failure.reason === "not_member" ? { label: "Configurar empresa", href: "/empresa/configuracion" } : undefined} />;
}

/** Keyed lifetime prevents members, drafts and in-flight actions leaking across accounts or companies. */
export function TeamPage() {
  const identity = useIdentity();
  const userId = identity.status === "ready" && identity.result?.ok ? identity.result.data.user?.id ?? null : null;
  const membership = useCompanyMembership(userId);
  if (identity.status === "loading") return <TeamWorkspace members={[]} loading />;
  if (identity.status === "unauthenticated") return <TeamReadFailure failure={{ ok: false, reason: "unauthenticated", reference: {} }} retry={identity.retry} />;
  if (!userId) return <TeamReadFailure failure={{ ok: false, reason: "no_response", reference: {} }} retry={identity.retry} />;
  return <ConnectedTeam key={JSON.stringify([userId, membership?.company.id ?? null])} userId={userId} role={membership?.role ?? null} companyId={membership?.company.id ?? null} />;
}

function ConnectedTeam({ userId, role, companyId }: { userId: string; role: TeamMemberRole | null; companyId: string | null }) {
  const team = useTeamMembers();
  const drafts = usePortfolioDrafts();
  const [selection, setSelection] = React.useState<{ member: CompanyMember; action: MemberRowAction } | null>(null);
  const [pending, setPending] = React.useState(false);
  const lock = React.useRef(false);
  const active = React.useRef(true);
  const [status, setStatus] = React.useState<{ tone: "success" | "error" | "info"; text: string } | null>(null);
  const [removed, setRemoved] = React.useState<string[]>([]);
  const [offboard, setOffboard] = React.useState<{ member: CompanyMember; client: OffboardFixtureClient; preview: OffboardPreview } | null>(null);
  const [offboardFailure, setOffboardFailure] = React.useState<OffboardError | null>(null);
  React.useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const fixtureMembers = offboardPrototypeEnabled() && companyId ? prototypeMembers(companyId) : [];
  const members = team.result?.ok ? [...team.result.members, ...fixtureMembers].filter(member => !removed.includes(member.id)) : [];
  const effectiveRole = companyId !== null && members.every(member => member.company_id === companyId) ? role : null;
  const selectedMember = selection ? members.find(member => member.id === selection.member.id) : undefined;
  const selectionAllowed = selectedMember && selection && memberRowActions(selectedMember, members, effectiveRole, userId).some(action => action.kind === selection.action.kind && (action.kind !== "role" || (selection.action.kind === "role" && action.role === selection.action.role)));
  async function choose(member: CompanyMember, action: MemberRowAction) {
    if (!offboardPrototypeEnabled() || action.kind !== "remove") { setSelection({ member, action }); return; }
    if (lock.current || !memberRowActions(member, members, effectiveRole, userId).some(item => item.kind === "remove")) return;
    lock.current = true; setPending(true); setOffboardFailure(null);
    const requested = new URLSearchParams(window.location.search).get("offboard");
    const scenario: OffboardScenario = requested === "none" || requested === "collaborator" ? requested : "responsible";
    const client = createOffboardFixtureClient(members, scenario);
    try {
      const preview = await client.preview(member.id);
      if (active.current) setOffboard({ member, client, preview });
    } catch (error) {
      if (active.current) reportOffboardFailure(error, "No pudimos consultar la salida");
    } finally { lock.current = false; if (active.current) setPending(false); }
  }
  function reportOffboardFailure(error: unknown, title = "No se quitó al miembro") {
    const failure = error instanceof OffboardError ? error : new OffboardError(500, "unconfirmed_result");
    setOffboardFailure(failure);
    const text = failure.code === "offboard_unresolved_vacancies" ? "Elige responsable para las vacantes pendientes." : "La lista no cambió. Vuelve a consultar la salida e inténtalo de nuevo.";
    setStatus({ tone: "error", text: title });
    notifyActionResult({ key: "team-member-write", type: "error", title, description: text, reference: { code: failure.code, status: failure.status, at: new Date().toISOString() } });
  }
  async function confirmOffboard(body: OffboardBody) {
    if (!offboard || lock.current || team.pending || !memberRowActions(offboard.member, members, effectiveRole, userId).some(action => action.kind === "remove")) return;
    lock.current = true; setPending(true);
    try {
      if (offboard.preview.vacancies.length) await offboard.client.offboard(offboard.member.id, body);
      else await offboard.client.remove(offboard.member.id);
      if (!active.current) return;
      const remaining = await offboard.client.list();
      if (!active.current) return;
      setRemoved(previous => [...previous, ...members.filter(member => !remaining.some(item => item.id === member.id)).map(member => member.id)]);
      setOffboard(null);
      setStatus({ tone: "info", text: "Miembro quitado en esta vista" });
      notifyActionResult({ key: "team-member-write", type: "info", title: "Miembro quitado en esta vista", description: "El cambio vive en memoria y se pierde al recargar. No se guardó en el servidor." });
    } catch (error) { if (active.current) reportOffboardFailure(error); }
    finally { lock.current = false; if (active.current) setPending(false); }
  }
  async function confirm() {
    if (!selection || !selectionAllowed || lock.current || team.pending) return;
    lock.current = true;
    setPending(true);
    setStatus(null);
    const { member, action } = selection;
    const result = await (action.kind === "role" ? changeTeamRoleAction(member.id, action.role) : removeTeamMemberAction(member.id))
      .catch((): TeamFailure => ({ ok: false, reason: "no_response", reference: {} }));
    if (!active.current) return;
    if (result.ok) {
      const text = action.kind === "role" ? "Rol actualizado" : "Miembro quitado del equipo";
      setStatus({ tone: "success", text });
      notifyActionResult({ key: "team-member-write", type: "success", title: text, description: "El cambio fue confirmado. Estamos actualizando la lista del equipo." });
      await team.refresh();
      if (!active.current) return;
      setSelection(null);
    } else {
      const uncertain = ["server_error", "no_response", "unrecognized_response"].includes(result.reason);
      const title = uncertain ? "No pudimos confirmar el cambio" : result.reason === "not_member" ? "El miembro ya no está disponible" : messages[result.reason].title;
      setStatus({ tone: "error", text: title });
      notifyActionResult({ key: "team-member-write", type: "error", title,
        description: uncertain ? "El cambio puede haberse aplicado. Consulta la lista antes de intentarlo otra vez; no repetiremos la acción automáticamente." : result.reason === "not_member" ? "Actualizamos el equipo para comprobar quién sigue perteneciendo a la empresa." : messages[result.reason].description,
        reference: { ...result.reference, at: new Date().toISOString() } });
      // Reconcile uncertain outcomes by reading once, never replaying a write.
      if (uncertain || result.reason === "not_member" || result.reason === "last_owner") await team.refresh();
      if (!active.current) return;
      setSelection(null);
    }
    lock.current = false;
    setPending(false);
  }
  if (!team.result) return <TeamWorkspace members={[]} loading />;
  if (!team.result.ok) return <TeamReadFailure failure={team.result} retry={() => { void team.refresh(); }} />;
  const workloadUnavailable = drafts.failure !== null || drafts.capped;
  return <>
    {workloadUnavailable && <StateCard icon={Users} tone="error" title="No pudimos cargar la carga de trabajo" description={drafts.capped ? "La consulta no incluye todas las vacantes. No mostramos conteos incompletos." : "Los miembros siguen disponibles. Vuelve a consultar las vacantes para ver la carga real."} primaryAction={{ label: "Reintentar carga", disabled: drafts.pending, onClick: drafts.retry }} />}
    <TeamWorkspace members={members} drafts={drafts.items} workloadPending={drafts.pending} workloadUnavailable={workloadUnavailable}
      role={effectiveRole} userId={userId} disabled={pending || team.pending} onAction={(member, action) => { void choose(member, action); }}
      actionStatusId={status ? "team-action-status" : undefined}
      feedback={status && <ActionStatusSlot><ActionStatus id="team-action-status" tone={status.tone} text={status.text} /></ActionStatusSlot>} />
    {offboard && <OffboardDialog preview={offboard.preview} members={members} pending={pending} failure={offboardFailure} onClose={() => { if (!pending) setOffboard(null); }} onConfirm={body => { void confirmOffboard(body); }} />}
    {/* Controlled dialog is a sibling of the list, not a modal root wrapping the screen. */}
    <ConfirmActionDialog open={selection !== null} onOpenChange={open => { if (!open) setSelection(null); }} onConfirm={() => { void confirm(); }}
      icon={selection?.action.kind === "remove" ? UserRoundMinus : UserRoundCog}
      title={selection?.action.kind === "remove" ? `¿Quitar a ${memberName(selection.member)} del equipo?` : `¿Cambiar el rol de ${selection ? memberName(selection.member) : "este miembro"}?`}
      description={selection?.action.kind === "remove" ? "Perderá el acceso a las vacantes y candidatos de la empresa." : selection?.action.kind === "role" && selection.action.role === "owner" ? "Podrá administrar los miembros y la configuración de la empresa." : "Dejará de poder administrar los miembros del equipo."}
      confirmLabel={selection?.action.kind === "remove" ? "Quitar del equipo" : "Cambiar rol"} pendingLabel={selection?.action.kind === "remove" ? "Quitando…" : "Guardando…"}
      tone={selection?.action.kind === "remove" ? "destructive" : "default"} pending={pending} confirmDisabled={!selectionAllowed || team.pending} />
  </>;
}
