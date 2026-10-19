import { CircleAlert } from "lucide-react";
import { ActionStatus, ActionStatusSlot } from "@/components/feedback/action-status";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { BoardProgress } from "./board-progress";
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
// Skeleton exception: repeat the draggable card's compact anatomy, including its independent handles.
export function BoardSkeleton({ columnCount = 6 }: { columnCount?: number }) {
  return <section aria-busy="true" aria-label="Tablero de candidatos" className="flex min-h-0 flex-1 flex-col gap-4">
    <span role="status" className="sr-only">Cargando tablero</span>
    <div aria-hidden="true" className="flex shrink-0 flex-wrap items-center justify-between gap-4"><Skeleton className="h-4 w-44" /><Skeleton className="h-4 w-56" /></div>
    <ScrollArea aria-hidden="true" className="pf-board-scroll h-[min(70dvh,640px)] min-h-[448px] min-w-0 md:h-auto md:min-h-0 md:flex-1">
      <div className="flex h-full min-h-[448px] w-max items-stretch gap-3 px-0.5 pt-0.5 pb-6">
        {Array.from({ length: columnCount }, (_, key) => <div key={key} className="stage-neutral stage-column flex min-h-[420px] w-[284px] shrink-0 flex-col rounded-xl p-2">
          <div className="stage-heading mb-3 flex h-10 shrink-0 items-center gap-2 rounded-lg px-2"><Skeleton className="size-2 rounded-full" /><Skeleton className="h-4 w-24" /><Skeleton className="h-5 w-6" /><Skeleton className="ml-auto size-10" /></div>
          <ScrollArea className="pf-column-scroll min-h-0 flex-1"><div className="p-0.5 pr-3"><ul className="flex flex-col gap-3"><li>
            <Card size="sm" className="pf-candidate-card rounded-xl gap-3 p-3">
              <CardHeader className="items-center gap-2 px-0">
                <div className="flex min-w-0 items-center gap-2"><Avatar className="size-8 shrink-0"><AvatarFallback><Skeleton className="size-8 rounded-full" /></AvatarFallback></Avatar><CardTitle className="min-w-0"><Skeleton className="h-10 w-32" /></CardTitle></div>
                <CardAction className="row-span-1 self-center"><Skeleton className="size-10" /></CardAction>
              </CardHeader>
              <CardContent className="flex flex-col gap-1.5 px-0"><Skeleton className="h-4 w-40" /><Skeleton className="h-4 w-44" /></CardContent>
              <Separator />
              <CardFooter className="min-h-6 gap-2 px-0"><Skeleton className="h-4 w-36" /><Skeleton className="-my-2 ml-auto size-10" /></CardFooter>
            </Card>
          </li></ul></div></ScrollArea>
        </div>)}
      </div><ScrollBar orientation="horizontal" />
    </ScrollArea>
  </section>;
}
export function BoardError({ failure, reading, notice, retry }: { failure: Failure; reading: boolean; notice: Notice | null; retry: () => void }) {
  const copy = boardErrorCopy(failure.reason);
  const needsSignIn = failure.reason === "unauthenticated";
  return <Empty><EmptyHeader className="max-w-md"><EmptyMedia variant="icon"><CircleAlert aria-hidden="true" /></EmptyMedia><EmptyTitle role="heading" aria-level={3} className="text-xl font-semibold">{copy.title}</EmptyTitle><EmptyDescription className="max-w-md">{copy.description}</EmptyDescription></EmptyHeader>
    <EmptyContent>
      <div className="flex w-full flex-col gap-2 sm:flex-row sm:justify-center">
        {needsSignIn && <Button nativeButton={false} role="link" className="min-h-10 w-full sm:w-auto" render={<a href="/empresa/login" />}>Iniciar sesión</Button>}
        <Button type="button" variant={needsSignIn ? "outline" : "default"} className="min-h-10 w-full sm:w-auto" disabled={reading} aria-describedby={notice ? "board-read-status" : undefined} onClick={retry}>{reading && <Spinner aria-hidden="true" data-icon="inline-start" />}Reintentar</Button>
      </div>
      <ActionStatusSlot>{notice && <ActionStatus id="board-read-status" tone={notice.tone} text={notice.text} />}</ActionStatusSlot>
    </EmptyContent>
  </Empty>;
}
export function BoardCoverage({ coverage }: { coverage: Board["coverage"] }) {
  const full = coverage.required !== null && coverage.covered >= coverage.required;
  return <BoardProgress label="Cobertura" value={<>{coverage.covered}{coverage.required !== null && ` de ${coverage.required}`} plazas cubiertas</>} progressLabel="Cobertura de plazas" progress={coverage.required !== null ? Math.min(100, coverage.covered / coverage.required * 100) : null}>
    <p>{full && <span className="text-status-success">Cobertura completa</span>}{coverage.full_coverage_reached_at && <>{full ? " · " : "Se completó el "}<MovementDate value={coverage.full_coverage_reached_at} /></>}</p>
  </BoardProgress>;
}
