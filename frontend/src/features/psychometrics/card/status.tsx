"use client";
import { ClipboardList } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { useInvitations } from "../sheet/state";
import { invitationStatusLabels as statusLabels } from "../sheet/invitation-labels";
import type { Invitation } from "../model";

export function invitationStatusText(invitation: Invitation) {
  if (invitation.status === "created") return `Enviada · vence ${new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "short", timeZone: "America/Mexico_City" }).format(new Date(invitation.expires_at)).replace(/\./g, "")}`;
  if (invitation.status === "in_progress") return `En curso · ${invitation.answered_count} de ${invitation.total_count}`;
  return statusLabels[invitation.status];
}
/** A compact data row beside ChecklistFit, not another badge or action rail. The
 * server owns expiry; old browser clocks must never change the reported status. */
export function PsychometricCardStatus({ participationId }: { participationId: string }) {
  const invitation = useInvitations()?.items.find(item => item.participation_id === participationId);
  if (!invitation) return null;
  return <div className="flex flex-col gap-1.5">
    <div className="flex items-start gap-2"><ClipboardList aria-hidden="true" className="size-3.5 shrink-0" /><div><p className="text-foreground">Psicometría</p><p>{invitationStatusText(invitation)}</p></div></div>
    {invitation.status === "in_progress" && <Progress aria-label="Preguntas respondidas" value={invitation.answered_count} max={invitation.total_count} />}
  </div>;
}
