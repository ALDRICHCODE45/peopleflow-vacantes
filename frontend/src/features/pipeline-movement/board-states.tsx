import { CheckCheck, CircleAlert } from "lucide-react";
import { ActionBar, ActionStatus } from "@/components/feedback/action-status";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { boardErrorCopy, type Notice } from "./board-feedback";
import type { Board, Failure } from "./model";
export function formatMovementDate(value: string, compact = false, withTime = false) {
  const date = new Date(value);
  const parts = new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "short", ...(!compact && { year: "numeric" }), timeZone: "America/Mexico_City" }).formatToParts(date);
  const short = parts.filter(part => part.type !== "literal").map(part => part.value).join(" ");
  return withTime ? `${short}, ${new Intl.DateTimeFormat("es-MX", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "America/Mexico_City" }).format(date)}` : short;
}
export function MovementDate({ value, compact, withTime }: { value: string; compact?: boolean; withTime?: boolean }) {
  return <time dateTime={value}>{formatMovementDate(value, compact, withTime)}</time>;
}
export function BoardSkeleton() {
  return <section aria-busy="true" aria-label="Tablero de candidatos" className="flex flex-col gap-4">
    <span role="status" className="sr-only">Cargando tablero</span>
    <Skeleton aria-hidden="true" className="h-8 w-64 max-w-full" />
    <div className="flex gap-3 overflow-hidden">{[0, 1, 2, 3].map(key => <div key={key} aria-hidden="true" className="stage-neutral stage-column flex w-[284px] shrink-0 flex-col gap-3 rounded-xl p-2"><Skeleton className="h-10 w-full rounded-lg" /><Card className="gap-3 rounded-xl p-3"><CardHeader className="flex flex-row items-center gap-2 px-0"><Skeleton className="size-8 rounded-full" /><Skeleton className="h-5 w-36" /></CardHeader><CardContent className="flex flex-col gap-2 px-0"><Skeleton className="h-3 w-32" /><Skeleton className="h-3 w-44" /><Skeleton className="mt-2 h-6 w-40" /></CardContent></Card></div>)}</div>
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
  const full = coverage.required !== null && coverage.covered >= coverage.required;
  return <div aria-label="Cobertura" className="pf-board-coverage flex min-w-40 flex-col gap-2 text-xs">
    <p className="flex items-center gap-2"><CheckCheck aria-hidden="true" className="size-4 shrink-0 text-status-success" />{full ? <span className="font-medium text-status-success">Cobertura completa</span> : <span><strong className="font-semibold tabular-nums">{coverage.covered}{coverage.required !== null && ` de ${coverage.required}`}</strong> plazas cubiertas</span>}</p>
    {coverage.required !== null && <Progress aria-label="Cobertura de plazas" value={Math.min(100, coverage.covered / coverage.required * 100)} />}
    {coverage.full_coverage_reached_at && <p className="text-[11px] text-muted-foreground">{!full && "Se completó el "}<MovementDate value={coverage.full_coverage_reached_at} /></p>}
  </div>;
}
