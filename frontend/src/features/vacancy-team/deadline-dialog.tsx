"use client";

import { useState } from "react";
import { CalendarDays } from "lucide-react";
import { ConfirmActionDialog } from "@/components/feedback/confirm-action-dialog";
import { FieldGroup } from "@/components/ui/field";
import { BusinessDateField } from "@/features/employer-vacancies/delivery-config/date-field";
import type { Delivery } from "@/features/jobs/drafts/pipeline/delivery-model";
import { formatLongDate, type Member } from "./model";

export function DeadlineDialog({ member, calendar, commitmentDate, pending, onConfirm, onClose }: {
  member: Member; calendar: Delivery["calendar"]; commitmentDate: string | null; pending: boolean; onConfirm: (deadline: string | null) => void; onClose: () => void;
}) {
  const [deadline, setDeadline] = useState<string | null>(member.recruiter_deadline);
  return <ConfirmActionDialog open onOpenChange={open => { if (!open) onClose(); }} onConfirm={() => onConfirm(deadline)} icon={CalendarDays} title={`Plazo de ${member.user.name}`}
    description="Cambia solo el plazo de este tramo. La fecha compromiso con el cliente y los demás plazos no cambian." confirmLabel="Guardar plazo" pendingLabel="Guardando…" pending={pending}>
    <FieldGroup>
      <BusinessDateField id="member-deadline" label="Plazo del reclutador" value={deadline} calendar={calendar} disabled={pending} onChange={setDeadline} clearLabel="Usar la fecha compromiso"
        description={commitmentDate ? `Si no lo defines, aplica la fecha compromiso: ${formatLongDate(commitmentDate)}.` : "Si no lo defines, aplica la fecha compromiso cuando exista."} />
    </FieldGroup>
  </ConfirmActionDialog>;
}
