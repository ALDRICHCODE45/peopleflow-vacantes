"use client";
import { useEffect, useRef, useState, type ComponentType, type ReactNode, type SVGProps } from "react";
import { Lock, PackageOpen, ShieldCheck, TriangleAlert, UserCheck, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { loadAuditedDetailAction, type AuditedDetail, type AuditedReport } from "./actions";
import type { MetricsFilters } from "./url-state";
import { DELIVERY_RESULT_LABEL, momentLabel, personName, requesterLabel, type MetricsFailure, type MetricsResult, type Person, type VacancyRow } from "./model";

export type AuditedTarget = { report: AuditedReport; vacancy: VacancyRow };
type Step = { kind: "notice" } | { kind: "loading" } | { kind: "done"; result: MetricsResult<AuditedDetail>; at: Date };
const COPY = {
  deliveries: { title: "Candidatos entregados", action: "Ver candidatos entregados", scope: "Verás los nombres de los candidatos en el orden en que llegaron a la etapa de corte y quién los entregó. No incluye CV ni datos de contacto." },
  placements: { title: "Placements", action: "Ver placements", scope: "Verás los nombres de los candidatos contratados, la fecha, quién recibió el crédito y si se sostuvo. No incluye CV ni datos de contacto." },
} as const;
const RECIPIENT_KIND = { direct: "directo", participant: "participación", shared: "compartido" } as const;
const PLACEMENT_STATUS = { active: "Activo", did_not_hold: "No se sostuvo" } as const;
const noResponse: MetricsFailure = { ok: false, reason: "no_response", reference: {} };

function SheetState({ icon: Icon, tone, title, description, action }: { icon: ComponentType<SVGProps<SVGSVGElement>>; tone: "error" | "empty"; title: string; description: string; action?: ReactNode }) {
  return <Empty className="gap-4 p-0 py-8">
    <EmptyHeader className="max-w-md">
      <EmptyMedia variant="icon" className={cn(tone === "error" ? "bg-destructive/10 text-destructive" : "bg-muted")}><Icon aria-hidden="true" /></EmptyMedia>
      <EmptyTitle role="heading" aria-level={3} className="text-base font-semibold">{title}</EmptyTitle>
      <EmptyDescription>{description}</EmptyDescription>
    </EmptyHeader>
    {action && <EmptyContent className="max-w-md">{action}</EmptyContent>}
  </Empty>;
}
const Who = ({ person, fallback }: { person: Person | null; fallback: string }) => person
  ? <span className="flex flex-wrap items-center gap-1.5">{personName(person)}{person.former_member && <Badge variant="neutral">Ex miembro</Badge>}</span>
  : <span className="text-muted-foreground">{fallback}</span>;

function DeliveriesTable({ items, vacancy }: { items: Extract<AuditedDetail, { report: "deliveries" }>["items"]; vacancy: VacancyRow }) {
  const { target, result } = vacancy.delivery;
  const judged = result === "on_time" || result === "late";
  return <Table>
    <TableHeader><TableRow><TableHead scope="col">#</TableHead><TableHead scope="col">Candidato</TableHead><TableHead scope="col">Llegó a la etapa de corte</TableHead><TableHead scope="col">Entregado por</TableHead></TableRow></TableHeader>
    <TableBody>{items.map((item, index) => <TableRow key={item.candidate.id || `${index}:${item.reached_at}`}>
      <TableCell className="tabular-nums">{index + 1}</TableCell>
      <TableCell className="whitespace-normal"><span className="flex flex-col gap-1">{item.candidate.full_name}
        {judged && target !== null && index === target - 1 && <Badge variant={result === "on_time" ? "success" : "review"}>{`Completó la meta · ${DELIVERY_RESULT_LABEL[result].toLowerCase()}`}</Badge>}</span></TableCell>
      <TableCell>{momentLabel(item.reached_at)}</TableCell>
      <TableCell className="whitespace-normal"><Who person={item.delivered_by} fallback="Postulación directa" /></TableCell>
    </TableRow>)}</TableBody>
  </Table>;
}
function PlacementsTable({ items }: { items: Extract<AuditedDetail, { report: "placements" }>["items"] }) {
  return <Table>
    <TableHeader><TableRow><TableHead scope="col">Candidato</TableHead><TableHead scope="col">Contratación</TableHead><TableHead scope="col">Crédito</TableHead><TableHead scope="col">Estado</TableHead></TableRow></TableHeader>
    <TableBody>{items.map((item, index) => <TableRow key={`${item.candidate.id}:${item.hired_at}:${index}`}>
      <TableCell className="whitespace-normal">{item.candidate.full_name}</TableCell>
      <TableCell>{momentLabel(item.hired_at)}</TableCell>
      <TableCell className="whitespace-normal"><span className="flex flex-col gap-1">{item.recipients.length ? item.recipients.map(recipient => <span key={recipient.person.user_id}><Who person={recipient.person} fallback="" /><span className="text-xs text-muted-foreground">{RECIPIENT_KIND[recipient.kind]}</span></span>) : <span className="text-muted-foreground">Sin crédito</span>}</span></TableCell>
      <TableCell><Badge variant={item.status === "active" ? "success" : "review"}>{PLACEMENT_STATUS[item.status]}</Badge></TableCell>
    </TableRow>)}</TableBody>
  </Table>;
}

function Outcome({ step, target, onRetry }: { step: Extract<Step, { kind: "done" }>; target: AuditedTarget; onRetry: () => void }) {
  const { result } = step;
  if (!result.ok) {
    if (result.reason === "forbidden") return <SheetState icon={Lock} tone="error" title="Consulta restringida" description="Solo el owner y los stakeholders de la empresa pueden ver este detalle." />;
    if (result.reason === "unauthenticated") return <SheetState icon={TriangleAlert} tone="error" title="Tu sesión terminó" description="Inicia sesión de nuevo para consultar este detalle." />;
    // A rejected request (the period) is not an unrecorded read: nothing was written, and no names either.
    if (result.reason === "invalid_filter" || result.reference.status === 400 || result.reference.status === 422) return <SheetState icon={TriangleAlert} tone="error" title="No pudimos abrir este detalle con el periodo elegido" description="Revisa el periodo e inténtalo de nuevo. No se mostró ningún dato." />;
    if (result.reason === "not_found") return <SheetState icon={TriangleAlert} tone="error" title="No encontramos esta vacante" description="La vacante ya no aparece en las métricas de tu empresa. No se mostró ningún dato." />;
    // Fail closed (§1.4): without the audit row there are no names, and the screen says why.
    return <SheetState icon={TriangleAlert} tone="error" title="No pudimos registrar la consulta" description="Por eso no mostramos los nombres: sin registro no hay datos. Nada cambió en la vacante. Vuelve a intentarlo."
      action={<Button type="button" className="min-h-10" onClick={onRetry}>Reintentar</Button>} />;
  }
  if (!result.data.items.length) return target.report === "deliveries"
    ? <SheetState icon={Users} tone="empty" title="Esta vacante aún no tiene candidatos entregados" description="Nadie ha llegado a la etapa de corte. La consulta quedó registrada aunque no hubiera nombres." />
    : <SheetState icon={UserCheck} tone="empty" title="Esta vacante aún no tiene placements" description="Nadie ha sido contratado en esta vacante. La consulta quedó registrada aunque no hubiera nombres." />;
  return result.data.report === "deliveries" ? <DeliveriesTable items={result.data.items} vacancy={target.vacancy} /> : <PlacementsTable items={result.data.items} />;
}

/**
 * Personal-data detail (§3.5, artboard 05): a notice step first, the list only after the API recorded the read, and
 * «Consulta registrada en Auditoría» under it. Any failure shows no names.
 */
export function AuditedDetailSheet({ target, period, onClose }: { target: AuditedTarget | null; period: Pick<MetricsFilters, "from" | "to">; onClose: () => void }) {
  const [step, setStep] = useState<Step>({ kind: "notice" });
  const generation = useRef(0);
  useEffect(() => { generation.current += 1; setStep({ kind: "notice" }); }, [target]);
  const consult = async () => {
    if (!target) return;
    const mine = ++generation.current;
    setStep({ kind: "loading" });
    const result = await loadAuditedDetailAction({ report: target.report, draftId: target.vacancy.draft_id, period: { from: period.from, to: period.to } }).catch(() => noResponse);
    if (mine === generation.current) setStep({ kind: "done", result, at: new Date() });
  };
  const copy = target ? COPY[target.report] : COPY.deliveries;
  const count = step.kind === "done" && step.result.ok ? step.result.data.items.length : null;
  return <Sheet open={target !== null} onOpenChange={open => { if (!open) onClose(); }}>
    <SheetContent className="sm:max-w-2xl">
      <SheetHeader>
        <SheetTitle>{count === null ? copy.title : `${copy.title} · ${count}`}</SheetTitle>
        <SheetDescription>{target ? `${target.vacancy.title ?? "Vacante sin título"} · ${requesterLabel(target.vacancy.requester)}` : ""}</SheetDescription>
      </SheetHeader>
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4">
        {step.kind === "notice" && <>
          <div role="note" className="flex items-start gap-3 rounded-xl bg-muted p-4 text-sm">
            <ShieldCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-primary" />
            <div className="flex flex-col gap-1"><strong className="font-medium">Esta consulta queda registrada en la auditoría de la empresa.</strong><p className="text-muted-foreground">Se guarda tu nombre, la vacante y la hora. El owner de la empresa puede verlo en Auditoría.</p></div>
          </div>
          <p className="text-sm text-muted-foreground">{copy.scope}</p>
        </>}
        {step.kind === "loading" && <div role="status" aria-label={`Cargando ${copy.title.toLowerCase()}`} aria-busy="true" className="flex flex-col gap-2">{[0, 1, 2, 3].map(index => <Skeleton key={index} aria-hidden="true" className="h-10 w-full" />)}</div>}
        {step.kind === "done" && target && <Outcome step={step} target={target} onRetry={() => void consult()} />}
      </div>
      <SheetFooter className="flex-row flex-wrap items-center justify-end gap-2 border-t">
        {step.kind === "notice" && <><Button type="button" variant="outline" className="min-h-10" onClick={onClose}>Cancelar</Button><Button type="button" className="min-h-10" onClick={() => void consult()}><PackageOpen aria-hidden="true" data-icon="inline-start" />{copy.action}</Button></>}
        {step.kind === "done" && step.result.ok && <p role="status" className="mr-auto flex items-center gap-2 text-xs text-muted-foreground"><ShieldCheck aria-hidden="true" className="size-3.5" />{`Consulta registrada en Auditoría · ${momentLabel(step.at)}`}</p>}
      </SheetFooter>
    </SheetContent>
  </Sheet>;
}
