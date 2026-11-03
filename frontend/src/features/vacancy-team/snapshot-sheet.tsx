"use client";

import { Camera, ChartNoAxesCombined, Clock3, Users } from "lucide-react";
import { ActionBar } from "@/components/feedback/action-status";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress, ProgressLabel } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { plural } from "@/features/employer-vacancies/plural";
import { stageClass } from "@/features/pipeline-movement/pipeline-presentation";
import { formatDate, sourceLabel, type Snapshot } from "./model";

export const snapshotSheetClass = "data-[side=right]:w-full data-[side=right]:sm:max-w-lg";
const publication = { draft: "Borrador", published: "Publicada", paused: "Pausada", closed: "Cerrada" };
const publicationTone = { draft: "info", published: "success", paused: "review", closed: "neutral" } as const;
const ratio = (value: number | null, total: number | null) => value !== null && total !== null && total > 0 ? Math.min(100, Math.max(0, value / total * 100)) : null;

/** Controlled without Trigger: opened by a movement action, never around the page. */
export function SnapshotSheet({ snapshot, from, to, open, onOpenChange }: { snapshot: Snapshot; from: string; to: string; open: boolean; onOpenChange: (open: boolean) => void }) {
  const { delivery, tramo } = snapshot;
  const stages = snapshot.stage_counts.filter(stage => stage.active > 0 || stage.discarded > 0);
  const maxStage = Math.max(1, ...snapshot.stage_counts.map(stage => stage.active));
  const discarded = snapshot.stage_counts.reduce((sum, stage) => sum + stage.discarded, 0);
  return <Sheet open={open} onOpenChange={onOpenChange}>
    <SheetContent showCloseButton={false} className={snapshotSheetClass}>
      <SheetHeader className="border-b">
        <div className="mb-2 flex size-10 items-center justify-center rounded-lg bg-primary/12 text-foreground ring-1 ring-primary/40"><Camera aria-hidden="true" className="size-5" /></div>
        <SheetTitle>Cómo estaba la vacante</SheetTitle>
        <SheetDescription>Así estaba la vacante cuando {from} se la pasó a {to}. Sirve para saber con qué avance la recibió.</SheetDescription>
      </SheetHeader>
      <div data-slot="snapshot-body" className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto p-6">
        <section aria-label="Avance de entrega" className="flex flex-col gap-3">
          <h3 className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground"><ChartNoAxesCombined aria-hidden="true" className="size-4" />Entrega</h3>
          <Progress value={ratio(delivery.delivered, delivery.target)}><ProgressLabel className="text-lg tabular-nums">{delivery.target === null ? `${plural(delivery.delivered, "candidato", "candidatos")} · Sin objetivo` : `${delivery.delivered} de ${plural(delivery.target, "candidato", "candidatos")}`}</ProgressLabel></Progress>
          <p className="text-xs text-muted-foreground">Fecha compromiso: {formatDate(delivery.commitment_date)}</p>
          {delivery.fulfilled_at && <p className="text-xs text-muted-foreground">Entrega cumplida el {formatDate(delivery.fulfilled_at)}</p>}
        </section>
        <Separator />
        <section aria-label="Tiempo utilizado" className="flex flex-col gap-3">
          <h3 className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground"><Clock3 aria-hidden="true" className="size-4" />Tiempo utilizado</h3>
          {tramo.business_days_total === null ? <p className="text-lg font-medium tabular-nums">{tramo.business_days_elapsed === null ? "Sin dato" : plural(tramo.business_days_elapsed, "día hábil usado", "días hábiles usados")} · sin plazo definido</p> : <Progress value={ratio(tramo.business_days_elapsed, tramo.business_days_total)}><ProgressLabel className="text-lg tabular-nums">{tramo.business_days_elapsed ?? "Sin dato"} de {plural(tramo.business_days_total, "día hábil", "días hábiles")}</ProgressLabel></Progress>}
          <p className="text-xs text-muted-foreground">Plazo: {formatDate(tramo.effective_deadline)} · {sourceLabel[tramo.deadline_source].toLocaleLowerCase("es-MX")}</p>
        </section>
        <Separator />
        <section aria-label="Candidatos por etapa" className="flex flex-col gap-4">
          <h3 className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground"><Users aria-hidden="true" className="size-4" />Candidatos por etapa</h3>
          {!stages.length && <p className="text-sm text-muted-foreground">Aún no había candidatos</p>}
          {stages.map(stage => {
            // Older fixtures may omit kind; real snapshots always carry the captured pipeline kind.
            const kind = stage.kind ?? (["new", "screening", "screening_ok", "in_process", "placement"].find(kind => kind === stage.stage_id) as "new" | "screening" | "screening_ok" | "in_process" | "placement" | undefined);
            return <Progress key={stage.stage_id} value={stage.active / maxStage * 100} className={`${stageClass(kind ?? "custom")} [&_[data-slot=progress-indicator]]:bg-(--stage)`}><ProgressLabel>{stage.stage_name}: {stage.active > 0 ? plural(stage.active, "candidato", "candidatos") : plural(stage.discarded, "descartado", "descartados")}</ProgressLabel></Progress>;
          })}
          {discarded > 0 && <p className="text-sm text-muted-foreground">{plural(discarded, "descartado", "descartados")}</p>}
        </section>
        <Separator />
        <div className="flex flex-wrap items-center gap-2"><Badge variant={publicationTone[snapshot.lifecycle.publication]}>{publication[snapshot.lifecycle.publication]}</Badge><Badge variant="neutral">{snapshot.lifecycle.process === "finished" ? "Proceso terminado" : snapshot.lifecycle.process === "active" ? "Proceso activo" : "Sin proceso"}</Badge></div>
        <p className="text-sm">{snapshot.placements.current === 0 ? "Aún no había placements" : plural(snapshot.placements.current, "placement", "placements")}</p>
        <p className="text-xs text-muted-foreground">Guardado el {formatDate(snapshot.captured_at)}</p>
      </div>
      <SheetFooter className="border-t"><ActionBar status={null}><SheetClose render={<Button type="button" variant="outline" className="min-h-10" />}>Cerrar</SheetClose></ActionBar></SheetFooter>
    </SheetContent>
  </Sheet>;
}
