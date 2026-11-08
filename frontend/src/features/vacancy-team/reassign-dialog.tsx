"use client";

import { useState } from "react";
import { UserRoundCog } from "lucide-react";
import { ConfirmActionDialog } from "@/components/feedback/confirm-action-dialog";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { BusinessDateField } from "@/features/employer-vacancies/delivery-config/date-field";
import { plural } from "@/features/employer-vacancies/plural";
import type { Delivery } from "@/features/jobs/drafts/pipeline/delivery-model";
import { ChoiceField, PersonField } from "./controls";
import { assignablePeople, formatDate, formatLongDate, reassignSchema, reasons, type CompanyMembers, type Reassign, type Snapshot, type Team } from "./model";

export function ReassignDialog({ team, company, calendar, commitmentDate = null, snapshot, onConfirm, onClose, pending = false, frozen = false }: { team: Team; company: CompanyMembers; calendar: Delivery["calendar"]; commitmentDate?: string | null; snapshot?: Snapshot; onConfirm: (body: Reassign) => void; onClose: () => void; pending?: boolean; frozen?: boolean }) {
  const [target, setTarget] = useState("");
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [deadline, setDeadline] = useState<string | null>(null);
  const [previous, setPrevious] = useState<Reassign["previous_responsible"]>("remove");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const responsible = team.members.find(member => member.function === "responsible");
  const currentMember = team.members.find(member => member.user.id === target);
  const candidates = assignablePeople(company.members).filter(member => member.user.id !== responsible?.user.id);
  function confirm() {
    const result = reassignSchema.safeParse({ to_user_id: target, reason, note, previous_responsible: previous, recruiter_deadline: currentMember ? null : deadline });
    if (!result.success) {
      const next = Object.fromEntries(result.error.issues.map(issue => [issue.path[0], issue.message]));
      if (!target) next.to_user_id = "Elige al nuevo responsable.";
      if (!reason) next.reason = "Elige el motivo de la reasignación.";
      setErrors(next);
      document.getElementById(!target ? "reassign-target" : !reason ? "reassign-reason" : "reassign-note")?.focus(); return;
    }
    const { note: normalizedNote, ...body } = result.data;
    onConfirm({ ...body, ...(normalizedNote ? { note: normalizedNote } : {}) });
  }
  if (!team.viewer.can.reassign_responsible) return null;
  return <ConfirmActionDialog open onOpenChange={open => { if (!open) onClose(); }} onConfirm={confirm} icon={UserRoundCog} title="Reasignar responsable" description={`El trabajo de ${responsible?.user.name ?? "la persona anterior"} queda a su nombre. La meta y la fecha compromiso no cambian.`} confirmLabel="Reasignar" pendingLabel="Reasignando…" pending={pending}>
    <FieldGroup inert={pending || frozen}>
      <PersonField id="reassign-target" label="Nuevo responsable" members={candidates} value={target} onChange={setTarget} error={errors.to_user_id} />
      <ChoiceField id="reassign-reason" label="Motivo" items={reasons} value={reason} onChange={setReason} error={errors.reason} />
      <Field data-invalid={!!errors.note}><FieldLabel htmlFor="reassign-note">Nota</FieldLabel><Textarea id="reassign-note" value={note} onChange={event => setNote(event.target.value)} aria-invalid={!!errors.note} aria-describedby={`reassign-note-help${errors.note ? " reassign-note-error" : ""}`} /><FieldDescription id="reassign-note-help">{reason === "other" ? "Obligatoria para Otro. " : "Opcional. "}Hasta 500 caracteres; el equipo podrá verla.</FieldDescription>{errors.note && <FieldError id="reassign-note-error">{errors.note}</FieldError>}</Field>
      {currentMember ? <p className="text-sm text-muted-foreground">Plazo actual: {formatDate(currentMember.effective_deadline)}. Para cambiar su plazo, usa Editar plazo.</p> : target ? <BusinessDateField id="reassign-deadline" label="Plazo del reclutador" value={deadline} calendar={calendar} disabled={pending} onChange={setDeadline}
        description={commitmentDate ? `Si no lo defines, aplica la fecha compromiso: ${formatLongDate(commitmentDate)}.` : "Sin plazo propio. Esta vacante todavía no tiene fecha compromiso."} /> : null}
      <Field><FieldLabel id="previous-label">¿Qué pasa con el responsable anterior?</FieldLabel>
        {/* Native Base UI single selection uses an array, as CardCustomSpacing does. Long labels stack. */}
        <ToggleGroup aria-labelledby="previous-label" variant="outline" value={[previous]} onValueChange={values => { if (values[0]) setPrevious(values[0] as Reassign["previous_responsible"]); }} className="flex-wrap">
          <ToggleGroupItem value="remove" className="min-h-10 aria-pressed:border-primary aria-pressed:bg-primary/10 aria-pressed:text-foreground">Sale de la vacante</ToggleGroupItem><ToggleGroupItem value="keep_as_collaborator" className="min-h-10 aria-pressed:border-primary aria-pressed:bg-primary/10 aria-pressed:text-foreground">Sigue como colaborador</ToggleGroupItem>
        </ToggleGroup>
        <FieldDescription>{previous === "remove" ? "Se cierra su tramo y pierde acceso a esta vacante." : "Su tramo continúa, sin reiniciar sus fechas."}</FieldDescription>
      </Field>
    </FieldGroup>
    {snapshot && <p className="text-sm text-muted-foreground">Hoy: {snapshot.delivery.target === null ? `${plural(snapshot.delivery.delivered, "candidato entregado", "candidatos entregados")} · Sin objetivo definido` : `${snapshot.delivery.delivered} de ${plural(snapshot.delivery.target, "candidato entregado", "candidatos entregados")}`} · {snapshot.tramo.business_days_elapsed === null || snapshot.tramo.business_days_total === null ? "Tiempo usado sin dato" : `${snapshot.tramo.business_days_elapsed} de ${plural(snapshot.tramo.business_days_total, "día hábil usado", "días hábiles usados")}`}. Esto queda guardado con la reasignación.</p>}
  </ConfirmActionDialog>;
}
