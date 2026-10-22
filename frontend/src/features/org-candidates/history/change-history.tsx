"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { History, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Item, ItemContent, ItemDescription, ItemGroup, ItemTitle } from "@/components/ui/item";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { TruncatedText } from "@/components/data-table/truncated-text";
import { StateCard } from "@/components/feedback/state-card";
import { useLanguageCatalog } from "@/features/languages/use-language-catalog";
import type { LanguageCatalog } from "@/features/languages/model";
import type { DetailFailure, OrgCandidateIdentity } from "../detail/detail-model";
import { loadOrgCandidateHistoryAction } from "./history-actions";
import type { HistoryEntry, HistoryResult, OrgCandidateHistory } from "./history-model";
import { historyChangeText, historyDate } from "./history-presentation";

type Props = { candidate: OrgCandidateIdentity; refreshKey: number };
/** Same section/Item composition as Procesos. A candidate switch owns a fresh read session. */
export function ChangeHistory({ candidate, refreshKey }: Props) {
  return <HistorySession key={`${candidate.kind}:${candidate.id}`} candidate={candidate} refreshKey={refreshKey} />;
}
function HistorySession({ candidate: { kind, id }, refreshKey }: Props) {
  const catalog = useLanguageCatalog();
  const [page, setPage] = useState<OrgCandidateHistory | null>(null);
  const [failure, setFailure] = useState<{ result: DetailFailure; cursor?: string } | null>(null);
  const [pending, setPending] = useState(true);
  const sequence = useRef(0);
  const inFlight = useRef(false);
  const read = useCallback(async (cursor?: string) => {
    const request = ++sequence.current;
    inFlight.current = true;
    setPending(true);
    setFailure(null);
    let result: HistoryResult;
    try { result = await loadOrgCandidateHistoryAction({ kind, id }, cursor); }
    catch { result = { ok: false, reason: "no_response", reference: {} }; }
    if (request !== sequence.current) return;
    if (result.ok) {
      const data = result.data;
      setPage(previous => cursor === undefined || !previous ? data : {
        items: [...previous.items, ...data.items.filter(item => !previous.items.some(existing => existing.id === item.id))],
        next_cursor: data.next_cursor,
      });
    } else setFailure({ result, cursor });
    inFlight.current = false;
    setPending(false);
  }, [kind, id]);
  useEffect(() => {
    // Refresh replaces the entire cursor chain, retaining useful content until the first page arrives.
    void read();
    return () => { sequence.current++; };
  }, [read, refreshKey]);
  const retry = () => { if (!inFlight.current) void read(failure?.cursor); };
  return <section aria-label="Historial de cambios" aria-busy={pending} className="flex min-w-0 flex-col gap-5">
    <h3 className="text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground">Historial de cambios</h3>
    {!page && pending && <HistorySkeleton />}
    {page && page.items.length > 0 && <ItemGroup>{page.items.map(entry => <HistoryItem key={entry.id} entry={entry} languages={catalog.data?.items ?? []} />)}</ItemGroup>}
    {page && page.items.length === 0 && !failure && <StateCard icon={History} tone="empty" title="Sin cambios todavía" description="Las correcciones que haga tu equipo aparecerán aquí." />}
    {failure && <StateCard icon={Info} tone="error" role="status" title="No pudimos cargar el historial"
      description={failure.result.reason === "unauthenticated" ? "Tu sesión expiró. Inicia sesión de nuevo para consultar el historial."
        : failure.result.reason === "forbidden" ? "Tu cuenta no tiene permiso para consultar este historial."
        : failure.result.reason === "not_found" ? "Este candidato ya no está disponible en tu organización."
        : "No se modificó ningún dato. Puedes volver a cargar el historial."}
      primaryAction={{ label: "Reintentar", onClick: retry }} />}
    {page?.next_cursor && !failure && <Button type="button" variant="outline" disabled={pending} aria-busy={pending}
      onClick={() => { if (!inFlight.current && page.next_cursor) void read(page.next_cursor); }}>
      {pending && <Spinner data-icon="inline-start" aria-hidden="true" />}Ver más
    </Button>}
  </section>;
}
function HistoryItem({ entry, languages }: { entry: HistoryEntry; languages: LanguageCatalog["items"] }) {
  return <Item variant="outline" role="listitem"><ItemContent className="min-w-0 gap-3">
    <ItemTitle className="max-w-full"><TruncatedText text={entry.actor.name ?? "Usuario dado de baja"} /></ItemTitle>
    <ItemDescription><time dateTime={entry.at} className="text-xs tabular-nums">{historyDate(entry.at)}</time></ItemDescription>
    <div className="flex min-w-0 flex-col gap-2 text-sm">
      {entry.kind === "cv_corrected" ? <TruncatedText text={`CV corregido: ${entry.file_name}`} />
        : entry.changes.map((change, index) => <TruncatedText key={index} text={historyChangeText(change, languages)} />)}
    </div>
  </ItemContent></Item>;
}
function HistorySkeleton() {
  return <><span role="status" className="sr-only">Cargando historial</span><ItemGroup aria-hidden="true">
    {[0, 1].map(index => <Item key={index} variant="outline" role="listitem"><ItemContent className="min-w-0 gap-3">
      <ItemTitle><Skeleton className="h-5 w-36 max-w-full" /></ItemTitle>
      <Skeleton className="h-4 w-48 max-w-full"><ItemDescription className="invisible">&nbsp;</ItemDescription></Skeleton>
      <div className="flex min-w-0 flex-col gap-2"><Skeleton className="h-5 w-full" /></div>
    </ItemContent></Item>)}
  </ItemGroup></>;
}
