"use client";
import { useEffect, useState } from "react";
import { CalendarDays, Clock, Flag, Target } from "lucide-react";
import { ActionBar, ActionStatus } from "@/components/feedback/action-status";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Item, ItemContent, ItemDescription, ItemGroup, ItemTitle } from "@/components/ui/item";
import { Skeleton } from "@/components/ui/skeleton";
import { loadDeliveryStatusAction } from "@/features/jobs/drafts/pipeline/delivery-actions";
import { fulfillmentCopy, type DeliveryPreview, type Fulfillment } from "@/features/jobs/drafts/pipeline/fulfillment-model";
import { MovementDate } from "@/features/pipeline-movement/board-states";
/** A business commitment is a civil date, not an instant in the viewer's zone. */
export function DeliveryCommitmentDate({ value }: { value: string | null }) {
  if (!value) return <>Sin definir</>;
  const parts = new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).formatToParts(new Date(`${value}T12:00:00Z`));
  return <time dateTime={value}>{parts.filter(part => part.type !== "literal").map(part => part.value).join(" ")}</time>;
}
export function FulfillmentCandidates({ candidates }: { candidates: DeliveryPreview["candidates"] }) {
  return <ItemGroup aria-label="Candidatos que cuentan para la entrega">{candidates.map(item => <Item key={item.participation_id} role="listitem" size="sm">
    <ItemContent><ItemTitle>{item.candidate.full_name}</ItemTitle><ItemDescription>Llegó el <MovementDate value={item.reached_at} withTime /></ItemDescription></ItemContent>
  </Item>)}</ItemGroup>;
}
export function FulfilledDelivery({ draftId, message }: { draftId: string; message?: string }) {
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState<{ fulfillment: Fulfillment | null; failed: boolean } | null>(null);
  useEffect(() => {
    let current = true;
    void loadDeliveryStatusAction(draftId).then(result => { if (current) setLoaded({ fulfillment: result.ok ? result.status.fulfillment : null, failed: !result.ok || !result.status.fulfillment }); })
      .catch(() => { if (current) setLoaded({ fulfillment: null, failed: true }); });
    return () => { current = false; };
  }, [draftId, attempt]);
  const frozen = loaded?.fulfillment;
  return <Card aria-labelledby="delivery-heading" aria-busy={!loaded}>
    <CardHeader className="border-b"><CardTitle><h3 id="delivery-heading">Entrega</h3></CardTitle>
      <CardDescription>La entrega ya se cumplió; su configuración no se puede cambiar.</CardDescription>
      <CardAction>{frozen ? <Badge variant={frozen.result === "late" ? "danger" : "success"}>{fulfillmentCopy(frozen)}</Badge> : loaded?.failed ? <Badge variant="neutral">Entrega cumplida</Badge> : <Skeleton aria-hidden="true" className="h-5 w-32" />} </CardAction>
    </CardHeader>
    <CardContent className="flex flex-col gap-4">
      {message && <ActionStatus id="delivery-frozen-status" tone="info" text={message} />}
      {frozen ? <>
        <dl className="grid gap-4 sm:grid-cols-2">
          <div><dt className="flex items-center gap-2 text-xs text-muted-foreground"><Clock aria-hidden="true" className="size-3.5" />Fecha de cumplimiento</dt><dd><MovementDate value={frozen.fulfilled_at} withTime /></dd></div>
          <div><dt className="flex items-center gap-2 text-xs text-muted-foreground"><Target aria-hidden="true" className="size-3.5" />Objetivo de entrega</dt><dd>{frozen.target} candidatos</dd></div>
          <div><dt className="flex items-center gap-2 text-xs text-muted-foreground"><Flag aria-hidden="true" className="size-3.5" />Columna de corte</dt><dd>{frozen.cutoff_stage_name}</dd></div>
          <div><dt className="flex items-center gap-2 text-xs text-muted-foreground"><CalendarDays aria-hidden="true" className="size-3.5" />Fecha compromiso</dt><dd><DeliveryCommitmentDate value={frozen.commitment_date} /></dd></div>
        </dl>
        <FulfillmentCandidates candidates={frozen.candidates} />
      </> : loaded?.failed ? <p>No pudimos cargar el resultado de la entrega. La configuración sigue bloqueada.</p> : <>
        <span role="status" className="sr-only">Cargando resultado de entrega</span>
        <div aria-hidden="true" className="grid gap-4 sm:grid-cols-2">{Array.from({ length: 4 }, (_, index) => <div key={index} className="flex flex-col gap-2"><Skeleton className="h-4 w-32" /><Skeleton className="h-5 w-44" /></div>)}</div>
        <ItemGroup aria-hidden="true"><Item size="sm"><ItemContent><ItemTitle><Skeleton className="h-5 w-32" /></ItemTitle><Skeleton className="h-4 w-44" /></ItemContent></Item></ItemGroup>
      </>}
    </CardContent>
    {loaded?.failed && <CardFooter className="border-t"><ActionBar status={<ActionStatus tone="error" id="delivery-result-error" text="Resultado no disponible" />}><Button className="min-h-10" variant="outline" aria-describedby="delivery-result-error" onClick={() => { setLoaded(null); setAttempt(value => value + 1); }}>Reintentar lectura</Button></ActionBar></CardFooter>}
  </Card>;
}
