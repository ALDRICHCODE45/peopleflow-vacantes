"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { BriefcaseBusiness, ChevronRight, FileText, SearchX, TriangleAlert } from "lucide-react";
import { SectionEmpty } from "@/components/feedback/state-card";
import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { plural } from "@/features/employer-vacancies/plural";
import { ReplacementTags } from "@/features/vacancy-lifecycle/ui/replacement-badges";
import { cn } from "@/lib/utils";
import { loadStakeholderVacanciesAction, type StakeholderVacanciesFailureReason } from "./actions";
import { STATUS_FILTERS, statusFilterOf, statusLabelOf, type StakeholderVacancy, type StatusFilter } from "./model";

const MESSAGES: Record<StakeholderVacanciesFailureReason, string> = {
  unauthenticated: "Tu sesión expiró. Inicia sesión para ver las vacantes.",
  forbidden: "No tienes permiso para ver estas vacantes. Usa la cuenta de stakeholder o de propietario de la empresa.",
  invalid_request: "No pudimos completar la consulta. Intenta cargar las vacantes de nuevo.",
  server_error: "Hubo un problema en el servidor. Es seguro reintentar; no se modificó ninguna vacante.",
  no_response: "No hubo respuesta del servidor. Revisa tu conexión y reintenta.",
  unrecognized_response: "No pudimos leer las vacantes recibidas. Es seguro reintentar; no se modificó nada.",
};
const VARIANT: Readonly<Record<Exclude<StatusFilter, "all">, BadgeVariant>> = { draft: "info", active: "accent", paused: "review", closed: "neutral" };
const META = "text-[12.5px] text-muted-foreground";
const initials = (title: string) => title.split(/\s+/u).slice(0, 2).map(word => word.charAt(0)).join("").toUpperCase();

type Loaded = { status: "ready"; items: StakeholderVacancy[]; nextCursor: string | null };
type State = { status: "loading" } | { status: "error"; reason: StakeholderVacanciesFailureReason } | Loaded;
/** The result of an action that rejects is the same «no response» the action itself reports. */
const safe = (cursor?: string) => (cursor === undefined ? loadStakeholderVacanciesAction() : loadStakeholderVacanciesAction({ cursor })).catch(() => ({ ok: false as const, reason: "no_response" as const, reference: {} }));

/** First page on mount, next pages by keyset cursor; a later page that fails keeps what is loaded and can be retried. */
function useStakeholderVacancies() {
  const [state, setState] = useState<State>({ status: "loading" });
  const [more, setMore] = useState<{ pending: boolean; failure: StakeholderVacanciesFailureReason | null }>({ pending: false, failure: null });
  const [attempt, setAttempt] = useState(0);
  const latest = useRef<Loaded | null>(null);
  useEffect(() => {
    let current = true;
    setState({ status: "loading" });
    latest.current = null;
    void safe().then(result => {
      if (!current) return;
      if (!result.ok) { setState({ status: "error", reason: result.reason }); return; }
      latest.current = { status: "ready", items: result.items, nextCursor: result.nextCursor };
      setState(latest.current);
    });
    return () => { current = false; };
  }, [attempt]);
  const retry = useCallback(() => setAttempt(value => value + 1), []);
  const loadMore = useCallback(async () => {
    const base = latest.current;
    if (!base?.nextCursor) return;
    setMore({ pending: true, failure: null });
    const result = await safe(base.nextCursor);
    // A reload started meanwhile owns the list now: this page belongs to the previous one.
    if (latest.current !== base) return;
    if (!result.ok) { setMore({ pending: false, failure: result.reason }); return; }
    const seen = new Set(base.items.map(item => item.id));
    latest.current = { status: "ready", items: [...base.items, ...result.items.filter(item => !seen.has(item.id))], nextCursor: result.nextCursor };
    setState(latest.current);
    setMore({ pending: false, failure: null });
  }, []);
  return { state, more, retry, loadMore };
}

function Row({ vacancy }: { vacancy: StakeholderVacancy }) {
  const title = vacancy.title || "Sin título";
  const filter = statusFilterOf(vacancy);
  return <li data-pf-stakeholder-vacancy={vacancy.id} className="relative flex items-center gap-3 px-4 py-4 transition-colors focus-within:bg-muted/50 hover:bg-muted/50 sm:px-5">
    <span aria-hidden="true" className="grid size-10 shrink-0 place-items-center rounded-lg bg-secondary text-[13px] font-bold text-foreground">{initials(title)}</span>
    <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
      <div className="min-w-0">
        {/* One link per row (stretched over the whole row): its name is the title. */}
        <Link href={`/empresa/vacantes/${vacancy.id}/documentos`} className="break-words text-[14.5px] font-semibold text-foreground outline-none after:absolute after:inset-0 focus-visible:after:ring-3 focus-visible:after:ring-ring/50">{title}</Link>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 sm:justify-end">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant={VARIANT[filter]} dot>{statusLabelOf(vacancy)}</Badge>
          <ReplacementTags kind={vacancy.kind} visibility={vacancy.visibility} />
        </div>
        <p className={cn(META, "flex items-center gap-1.5 tabular-nums")}><FileText aria-hidden="true" className="size-3.5" />{vacancy.documents_count === 0 ? "Sin documentos" : plural(vacancy.documents_count, "documento", "documentos")}</p>
      </div>
    </div>
    <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
  </li>;
}

function Loading() {
  return <div role="status" aria-label="Cargando vacantes" className="divide-y divide-border">
    {[0, 1, 2].map(key => <div key={key} aria-hidden="true" className="flex items-center gap-3 px-4 py-4 sm:px-5"><Skeleton className="size-10 shrink-0" /><div className="flex flex-1 flex-col gap-2"><Skeleton className="h-5 w-1/2" /><Skeleton className="h-4 w-1/4" /></div></div>)}
  </div>;
}

/**
 * S12: the stakeholder's own read-only «Vacantes» list. Rows come from `GET /v2/me/company/stakeholder/vacancies` (keyset,
 * «Cargar más»), the filters work on what is loaded, and each row leads to that vacancy's Documentos tab. Nothing here edits.
 */
export function StakeholderVacanciesPage() {
  const { state, more, retry, loadMore } = useStakeholderVacancies();
  const [filter, setFilter] = useState<StatusFilter>("all");
  const items = state.status === "ready" ? state.items : [];
  const counts: Record<StatusFilter, number> = { all: items.length, draft: 0, active: 0, paused: 0, closed: 0 };
  for (const item of items) counts[statusFilterOf(item)] += 1;
  const shown = filter === "all" ? items : items.filter(item => statusFilterOf(item) === filter);
  const nextCursor = state.status === "ready" ? state.nextCursor : null;
  // While more pages exist the counts only cover what is loaded (they grew «Todas 20» → «Todas 41» after «Cargar más»): they read «20+».
  const partial = nextCursor !== null;

  let body;
  if (state.status === "loading") body = <Loading />;
  else if (state.status === "error") body = <SectionEmpty icon={TriangleAlert} tone="empty" role="alert" title="No pudimos cargar las vacantes" description={MESSAGES[state.reason]} primaryAction={{ label: "Reintentar", onClick: retry }} />;
  else if (items.length === 0 && nextCursor === null) body = <SectionEmpty icon={BriefcaseBusiness} tone="empty" title="Todavía no hay vacantes"
    description="Cuando tu empresa tenga vacantes, las verás aquí con sus documentos, en solo lectura." />;
  else if (shown.length === 0) body = <SectionEmpty icon={SearchX} tone="empty" title="Sin resultados"
    description={`No hay vacantes ${STATUS_FILTERS.find(entry => entry.value === filter)?.label.toLowerCase()} entre las que ya se cargaron.${nextCursor ? " Carga más para seguir buscando." : ""}`}
    primaryAction={{ label: "Mostrar todas", onClick: () => setFilter("all") }} />;
  else body = <ul aria-label="Vacantes" className="divide-y divide-border">{shown.map(item => <Row key={item.id} vacancy={item} />)}</ul>;

  const ready = state.status === "ready";
  return <div data-pf-stakeholder-vacancies className="flex flex-col gap-5">
    {ready && items.length > 0 && <Tabs value={filter} onValueChange={value => setFilter(value as StatusFilter)}>
      <div className="max-w-full overflow-x-auto pb-1">
        <TabsList aria-label="Filtrar por estado">
          {STATUS_FILTERS.map(entry => <TabsTrigger key={entry.value} value={entry.value}>{entry.label}<Badge variant="secondary">{counts[entry.value]}{partial && "+"}</Badge></TabsTrigger>)}
        </TabsList>
      </div>
    </Tabs>}
    {ready && items.length > 0 && <p data-pf-stakeholder-shown="" role="status" className={META}>Mostrando {plural(shown.length, "vacante", "vacantes")}{partial && " · hay más por cargar"}</p>}
    <Card aria-busy={state.status === "loading"}>
      <CardContent className="-mx-(--card-spacing)">{body}</CardContent>
    </Card>
    {ready && more.failure && <p role="alert" className="rounded-2xl bg-muted px-4 py-3 text-sm">No pudimos cargar más vacantes. {MESSAGES[more.failure]}</p>}
    {ready && nextCursor !== null && <div className="flex justify-center">
      <Button type="button" variant="outline" className="min-h-10" onClick={() => void loadMore()} disabled={more.pending} aria-busy={more.pending}>
        {more.pending && <Spinner aria-hidden="true" data-icon="inline-start" />}{more.pending ? "Cargando…" : "Cargar más"}
      </Button>
    </div>}
  </div>;
}
