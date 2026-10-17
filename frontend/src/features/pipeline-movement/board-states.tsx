import { CalendarDays, CircleAlert, Users } from "lucide-react";
import { ActionBar, ActionStatus } from "@/components/feedback/action-status";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { boardErrorCopy, type Notice } from "./board-feedback";
import type { Board, Failure } from "./model";
const dateFormat = new Intl.DateTimeFormat("es-MX", { dateStyle: "long", timeZone: "America/Mexico_City" });
export function MovementDate({ value }: { value: string }) {
  return <time dateTime={value}>{dateFormat.format(new Date(value))}</time>;
}
export function BoardSkeleton() {
  return <section aria-busy="true" aria-label="Tablero de candidatos" className="flex flex-col gap-4">
    <span role="status" className="sr-only">Cargando tablero</span>
    <Skeleton aria-hidden="true" className="h-8 w-64 max-w-full" />
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{[0, 1, 2].map(key => <Card key={key} aria-hidden="true"><CardHeader><Skeleton className="h-6 w-40" /><Skeleton className="h-5 w-24" /></CardHeader><CardContent><Skeleton className="h-36 w-full" /></CardContent></Card>)}</div>
  </section>;
}
export function BoardError({ failure, reading, notice, retry }: { failure: Failure; reading: boolean; notice: Notice | null; retry: () => void }) {
  const copy = boardErrorCopy(failure.reason);
  return <Empty><EmptyHeader><EmptyMedia variant="icon"><CircleAlert aria-hidden="true" /></EmptyMedia><EmptyTitle role="heading" aria-level={3}>{copy.title}</EmptyTitle><EmptyDescription>{copy.description}</EmptyDescription></EmptyHeader>
    <EmptyContent><ActionBar status={notice ? <ActionStatus id="board-read-status" tone={notice.tone} text={notice.text} /> : null}>
      <Button type="button" variant="outline" className="min-h-10" disabled={reading} aria-describedby={notice ? "board-read-status" : undefined} onClick={retry}>{reading && <Spinner aria-hidden="true" data-icon="inline-start" />}Reintentar</Button>
    </ActionBar>{failure.reason === "unauthenticated" && <a className="inline-flex min-h-10 items-center underline" href="/empresa/login">Iniciar sesión</a>}</EmptyContent>
  </Empty>;
}
export function BoardCoverage({ coverage }: { coverage: Board["coverage"] }) {
  return <Card size="sm"><CardHeader><h3 className="flex items-center gap-2 font-heading text-base font-semibold"><Users aria-hidden="true" className="size-5" />Cobertura</h3></CardHeader><CardContent className="flex flex-col gap-3">
    <p className="text-lg font-semibold tabular-nums">{coverage.required === null ? `${coverage.covered} plazas cubiertas` : `${coverage.covered} de ${coverage.required} plazas cubiertas`}</p>
    {coverage.required !== null && <Progress aria-label="Cobertura de plazas" value={Math.min(100, coverage.covered / coverage.required * 100)} />}
    {coverage.full_coverage_reached_at && <div className="flex flex-wrap items-center gap-2"><Badge variant="success">Cobertura completa alcanzada</Badge><span className="flex items-center gap-1 text-xs text-muted-foreground"><CalendarDays aria-hidden="true" className="size-3.5" /><MovementDate value={coverage.full_coverage_reached_at} /></span></div>}
  </CardContent></Card>;
}
