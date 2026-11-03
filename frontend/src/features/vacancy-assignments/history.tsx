"use client";

import { useEffect, useRef, useState } from "react";
import { CircleAlert, History } from "lucide-react";
import { StateCard, SectionEmpty } from "@/components/feedback/state-card";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { DraftEditErrorState } from "@/features/jobs/drafts/reopen/error-state";
import { AssignmentError, historySchema, readOverview, summarize, type AssignmentClient, type AssignmentHistoryPage, type Summary } from "./client";
import { HistoryTable } from "./history-table";

function SummaryRow({ summary }: { summary: Summary | null }) {
  const cards = [
    { label: "Vacantes en las que trabajas ahora", value: summary?.current },
    { label: "Candidatos entregados", value: summary?.delivered },
    { label: "Placements", value: summary?.placements },
  ];
  return <section aria-label="Resumen de tu trabajo" className="grid grid-cols-1 gap-3 sm:grid-cols-3">
    {cards.map(card => <Card key={card.label} size="sm"><CardHeader>
      <CardTitle>{summary ? <h3 className="text-[22px] font-bold tabular-nums">{summary.incomplete ? "al menos " : ""}{card.value}</h3> : <Skeleton aria-hidden="true" className="h-7 w-10" />}</CardTitle>
      <CardDescription>{summary ? card.label : <Skeleton aria-hidden="true" className="h-5 w-24" />}</CardDescription>
    </CardHeader></Card>)}
  </section>;
}
/** Read-only own history. Summary preloading is independent of visible backend pages. */
export function AssignmentHistory({ client }: { client: AssignmentClient }) {
  const [loaded, setLoaded] = useState<{ first: AssignmentHistoryPage; summary: Summary } | null>(null);
  const [failure, setFailure] = useState(false);
  const [expired, setExpired] = useState(false);
  const summarized = useRef(new Set<string>());
  const [attempt, setAttempt] = useState(0);
  const [pages, setPages] = useState<AssignmentHistoryPage | null>(null);
  const [moreFailure, setMoreFailure] = useState(false);
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  const lifetime = useRef(0);
  useEffect(() => {
    const generation = ++lifetime.current;
    async function load() {
      try { return await readOverview(client); }
      catch (error) {
        if (error instanceof AssignmentError && error.code === "invalid_cursor") return readOverview(client);
        throw error;
      }
    }
    load().then(result => { if (generation === lifetime.current) { summarized.current = new Set(result.cursors); setLoaded(result); setPages(result.first); setFailure(false); setMoreFailure(false); } }).catch(error => { if (generation === lifetime.current) { if (error instanceof AssignmentError && error.status === 401) setExpired(true); else setFailure(true); } });
    return () => { lifetime.current = generation + 1; };
  }, [client, attempt]);
  async function more() {
    if (!pages?.next_cursor || busy.current) return;
    busy.current = true; setPending(true);
    const generation = lifetime.current;
    try {
      const next = historySchema.parse(await client.getHistory(pages.next_cursor));
      if (generation === lifetime.current) {
        if (!summarized.current.has(pages.next_cursor)) {
          summarized.current.add(pages.next_cursor);
          setLoaded(previous => previous ? { ...previous, summary: summarize(next.items, !!next.next_cursor, previous.summary) } : previous);
        }
        setPages(previous => previous ? { items: [...previous.items, ...next.items], next_cursor: next.next_cursor } : next); setMoreFailure(false);
      }
    } catch (error) {
      if (generation === lifetime.current) {
        if (error instanceof AssignmentError && error.status === 401) setExpired(true);
        else if (error instanceof AssignmentError && error.code === "invalid_cursor") { setLoaded(null); setPages(null); setAttempt(value => value + 1); }
        else setMoreFailure(true);
      }
    }
    finally { busy.current = false; if (generation === lifetime.current) setPending(false); }
  }
  if (expired) return <DraftEditErrorState reason="unauthenticated" />;
  if (failure) return <StateCard icon={CircleAlert} tone="error" title="No pudimos cargar tu historial" description="Tu trabajo sigue a tu nombre. Puedes reintentar esta consulta sin cambiar datos." primaryAction={{ label: "Reintentar", onClick: () => { setFailure(false); setAttempt(value => value + 1); } }} />;
  const loading = !loaded;
  const footer = moreFailure ? <StateCard icon={CircleAlert} tone="error" title="No pudimos cargar más vacantes" description="Lo que ya consultaste sigue disponible. Reintentar no cambia datos." primaryAction={{ label: "Reintentar", onClick: () => void more() }} /> : pages?.next_cursor ? <Button type="button" variant="outline" className="min-h-10" disabled={pending} onClick={() => void more()}>{pending && <Spinner aria-hidden="true" />}{pending ? "Cargando…" : "Cargar más"}</Button> : null;
  return <div aria-busy={loading || pending || undefined} className="flex min-w-0 flex-col gap-5">
    {loading && <span role="status" className="sr-only">Cargando tu historial</span>}
    <SummaryRow summary={loaded?.summary ?? null} />
    {loaded && !loaded.first.items.length ? <Card><CardHeader><CardTitle><h2>Tu trabajo en vacantes</h2></CardTitle></CardHeader><CardContent><SectionEmpty icon={History} tone="empty" title="Todavía no has trabajado en vacantes" description="Aquí verás tu trabajo y tus resultados cuando te sumes a una vacante. Mientras tanto, puedes consultar tus vacantes." primaryAction={{ label: "Ver vacantes", href: "/empresa/vacantes" }} /></CardContent></Card> : <HistoryTable loading={loading} items={pages?.items ?? []} footer={footer} />}
  </div>;
}
