"use client";

import { Fragment, useState } from "react";
import { UserRoundMinus } from "lucide-react";
import { ConfirmActionDialog } from "@/components/feedback/confirm-action-dialog";
import { Button } from "@/components/ui/button";
import { FieldError, FieldGroup } from "@/components/ui/field";
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemSeparator, ItemTitle } from "@/components/ui/item";
import { PersonField } from "@/features/vacancy-team/controls";
import { plural } from "@/features/employer-vacancies/plural";
import type { CompanyMember } from "./members-model";
import type { OffboardBody, OffboardError, OffboardPreview } from "./offboard-client";

type Props = { preview: OffboardPreview; members: readonly CompanyMember[]; pending?: boolean; failure?: OffboardError | null; onClose: () => void; onConfirm: (body: OffboardBody) => void };
export function OffboardDialog({ preview, members, pending = false, failure, onClose, onConfirm }: Props) {
  const candidates = members.flatMap(member => member.user && member.user.id !== preview.user.id ? [{ ...member, user: member.user }] : []);
  // Prefer the current teammate present on the most affected teams; company order breaks ties.
  const suggestion = [...candidates].sort((a, b) => preview.vacancies.filter(v => v.team.some(p => p.user_id === b.user.id)).length - preview.vacancies.filter(v => v.team.some(p => p.user_id === a.user.id)).length)[0];
  const [target, setTarget] = useState(() => suggestion && preview.vacancies.some(v => v.team.some(p => p.user_id === suggestion.user.id)) ? suggestion.user.id : "");
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const responsible = preview.vacancies.length > 0;
  const valid = (id: string) => candidates.some(person => person.user.id === id);
  const resolved = preview.vacancies.every(v => valid(overrides[v.draft_id] || target));
  const body: OffboardBody = { default_to_user_id: target || null, reassignments: Object.entries(overrides).filter(([, id]) => id).map(([draft_id, to_user_id]) => ({ draft_id, to_user_id })) };
  const unresolved = failure?.code === "offboard_unresolved_vacancies" ? failure.vacancies : [];
  return <ConfirmActionDialog open onOpenChange={open => { if (!open) onClose(); }} onConfirm={() => { if (resolved) onConfirm(body); }} icon={UserRoundMinus}
    title={responsible ? `Quitar a ${preview.user.full_name} de la empresa` : `¿Quitar a ${preview.user.full_name} del equipo?`}
    description={responsible ? "Cada vacante necesita un nuevo responsable antes de su salida. Su trabajo queda a su nombre." : "Perderá el acceso a las vacantes y candidatos de la empresa."}
    confirmLabel={responsible ? "Quitar y reasignar" : "Quitar del equipo"} pendingLabel="Quitando…" tone="destructive" pending={pending} confirmDisabled={!resolved}>
    {(responsible || preview.other_tramos > 0 || unresolved.length > 0) && <>
    {responsible && <>
      <FieldGroup><PersonField id="offboard-default" label="Pasar todas a" members={candidates} value={target} onChange={setTarget} /></FieldGroup>
      <ItemGroup className="gap-0" aria-label="Vacantes por reasignar">{preview.vacancies.map((vacancy, index) => <Fragment key={vacancy.draft_id}>
        {index > 0 && <ItemSeparator className="my-0" />}
        <Item size="sm"><ItemContent className="min-w-0"><ItemTitle className="break-words">{vacancy.title}</ItemTitle><ItemDescription>{plural(vacancy.team.length, "persona", "personas")} en el equipo actual</ItemDescription>
          {expanded[vacancy.draft_id] ? <PersonField id={`offboard-${vacancy.draft_id}`} label={`Responsable de ${vacancy.title}`} members={candidates} value={overrides[vacancy.draft_id] || target} onChange={id => setOverrides(previous => ({ ...previous, [vacancy.draft_id]: id }))} error={unresolved.some(v => v.draft_id === vacancy.draft_id) ? "Elige al nuevo responsable." : undefined} /> : <p className="text-sm">{(() => { const name = candidates.find(p => p.user.id === (overrides[vacancy.draft_id] || target))?.user.full_name; return name ? <>Pasa a <span className="font-medium">{name}</span></> : <span className="text-muted-foreground">Sin responsable elegido</span>; })()}</p>}
        </ItemContent><ItemActions><Button type="button" variant="ghost" className="min-h-10" disabled={pending} aria-label={`Cambiar responsable de ${vacancy.title}`} aria-expanded={!!expanded[vacancy.draft_id]} onClick={() => setExpanded(previous => ({ ...previous, [vacancy.draft_id]: !previous[vacancy.draft_id] }))}>Cambiar</Button></ItemActions></Item>
      </Fragment>)}</ItemGroup>
      <p className="text-sm text-muted-foreground">Motivo: baja del reclutador</p>
    </>}
    {preview.other_tramos > 0 && <p className="text-sm text-muted-foreground">También sale de {plural(preview.other_tramos, "vacante donde colabora", "vacantes donde colabora")}. Su trabajo queda a su nombre.</p>}
    {unresolved.length > 0 && <FieldError>Elige responsable para: {unresolved.map(v => v.title).join(", ")}. No se quitó al miembro.</FieldError>}
    </>}
  </ConfirmActionDialog>;
}
