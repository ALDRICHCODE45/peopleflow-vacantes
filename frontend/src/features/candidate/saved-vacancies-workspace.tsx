"use client";
import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Bookmark, CircleCheck, CircleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { DashboardPageContent } from "@/components/dashboard-page-content";
import { ActionBar, ActionStatus } from "@/components/feedback/action-status";
import { ConfirmActionDialog } from "@/components/feedback/confirm-action-dialog";
import { notifyActionResult } from "@/components/feedback/notify";
import { SectionEmpty, StateCard } from "@/components/feedback/state-card";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useIdentity } from "@/features/identity/identity-session";
import type { Identity } from "@/features/identity/model";
import { candidateAuthHref } from "@/features/identity/return-to";
import { InfoPopover } from "@/features/psychometrics/help/info-popover";
import { loadSavedJobsAction, removeSavedJobAction, removeClosedSavedJobsAction, saveJobAction } from "@/features/saved-vacancies/actions";
import { workspaceErrorCopy } from "@/features/saved-vacancies/workspace/feedback";
import type { SavedJobItem, SavedJobsFailure } from "@/features/saved-vacancies/model";
import { savedJobIdsKey, savedJobsKey, savedJobsQueryClient, updateSavedJobIds } from "@/features/saved-vacancies/queries";
import { useApplicationStatuses } from "./saved/application-status";
import { CARD, ClosedRow, EmptySaved, LoadingSavedJobs, QueueRow, VacancyPreview, type Entry, type RemoveControl } from "./saved/queue";
import { rank, reasons, SORT_KEYS, SORTS, summary, type SortKey } from "./saved/ranking";
import { useNarrow } from "./saved/use-narrow";
import motion from "./saved/saved.module.css";

const plural = (n: number, singular: string, multiple: string) => `${n} ${n === 1 ? singular : multiple}`;
const noResponse: SavedJobsFailure = { ok: false, reason: "no_response", reference: {} };
type Line = { tone: "success" | "error"; text: string; action?: { title: string; onClick: () => void } };
const STATUS_ID = "saved-workspace-status";

export function SavedVacanciesWorkspace() {
  const identity = useIdentity();
  if (identity.status !== "ready" || !identity.result?.ok || identity.result.data.role !== "candidate") return <LoadingSavedJobs />;
  return <CandidateSavedJobs key={identity.result.data.user.id} identity={identity.result.data} />;
}

function CandidateSavedJobs({ identity }: { identity: Identity }) {
  const client = savedJobsQueryClient(identity);
  const list = useQuery({ queryKey: savedJobsKey, queryFn: async () => {
    const result = await loadSavedJobsAction().catch(() => noResponse);
    if (!result.ok) throw result;
    return result.data;
  } }, client);
  const [now] = useState(() => Date.now());
  const narrow = useNarrow();
  const [sort, setSort] = useState<SortKey>("suggested");
  // undefined: the first row; null: nothing expanded (narrow only, after collapsing the open row).
  const [selectedId, setSelectedId] = useState<string | null>();
  const [focusTarget, setFocusTarget] = useState<string>();
  const [entrance, setEntrance] = useState<"idle" | "on" | "off">("idle");
  const [line, setLine] = useState<Line>();
  const [busy, setBusy] = useState<string>();
  const locked = useRef(false);
  const [confirm, setConfirm] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const bulkButton = useRef<HTMLButtonElement>(null);
  const items = list.data?.items ?? [];
  const pending = items.filter(item => item.availability === "open" && !item.application);
  const applied = items.filter(item => item.availability === "open" && item.application);
  const closed = items.filter(item => item.availability === "closed");
  const statuses = useApplicationStatuses(applied.map(item => item.application!.id), client);
  const queue: Entry[] = rank(pending, sort, now).map((item, index) => ({ item, rank: index + 1, reasons: reasons(item, sort, pending, now) }));
  const selectable: Entry[] = [...queue, ...applied.map(item => ({ item, rank: null, reasons: [], status: statuses?.get(item.application!.id) }))];
  const chosen = selectedId ? selectable.find(entry => entry.item.job_id === selectedId) : undefined;
  const current = chosen ?? (selectedId === null && narrow ? undefined : selectable[0]);

  // One entrance, on the first render with content; `.enter` is dropped once it has played.
  if (list.data && entrance === "idle") setEntrance("on");
  useEffect(() => {
    if (entrance !== "on") return;
    const timer = setTimeout(() => setEntrance("off"), 700);
    return () => clearTimeout(timer);
  }, [entrance]);
  // After Quitar / Deshacer, focus the row that takes its place (or the restored row), else the page heading.
  useEffect(() => {
    if (!focusTarget) return;
    const target = focusTarget === "heading" ? null : root.current?.querySelector<HTMLElement>(`[data-pf-saved-vacancy="${focusTarget}"] [data-pf-saved-focus]`);
    if (!target && focusTarget !== "heading" && list.data?.items.some(item => item.job_id === focusTarget)) return;
    (target ?? heading.current)?.focus();
    setFocusTarget(undefined);
  }, [focusTarget, list.data]);

  function failure(result: SavedJobsFailure, retry: () => void, removing: boolean) {
    const copy = workspaceErrorCopy(result, removing);
    const action = result.reason === "unauthenticated" ? { title: "Iniciar sesión", onClick: () => { window.location.assign(candidateAuthHref("login", "/candidato/guardadas")); } }
      : copy.retry ? { title: "Reintentar", onClick: retry } : undefined;
    setLine({ tone: "error", text: copy.title, action });
    notifyActionResult({ key: "saved-workspace", type: "error", title: copy.title, description: copy.description, action, reference: { ...result.reference, at: new Date().toISOString() } });
  }
  async function mutate(kind: "remove" | "undo" | "bulk", id?: string, next?: string) {
    if (locked.current || (id && client.isMutating({ mutationKey: ["saved-jobs", "toggle", id] }))) return;
    locked.current = true; setBusy(id ?? "bulk"); setLine(undefined);
    try {
      const result = await (kind === "bulk" ? removeClosedSavedJobsAction() : kind === "remove" ? removeSavedJobAction(id!) : saveJobAction(id!)).catch(() => noResponse);
      if (!result.ok) { failure(result, () => void mutate(kind, id, next), kind !== "undo"); return; }
      if (kind === "bulk") {
        // Availability may have changed since the list read: never infer deleted IDs.
        await client.invalidateQueries({ queryKey: savedJobsKey });
        setConfirm(false);
      } else {
        updateSavedJobIds(client, id!, kind === "undo");
        await client.invalidateQueries({ queryKey: savedJobsKey });
      }
      await client.invalidateQueries({ queryKey: savedJobIdsKey });
      const title = kind === "bulk" && "removed" in (result.data ?? {})
        ? `Quitaste ${plural((result.data as { removed: number }).removed, "vacante", "vacantes")}`
        : kind === "remove" ? "Quitaste la vacante" : "Vacante guardada";
      const action = kind === "remove" ? { title: "Deshacer", onClick: () => void mutate("undo", id) } : undefined;
      setLine({ tone: "success", text: title, action });
      notifyActionResult({ key: "saved-workspace", type: "success", title, description: kind === "undo" ? "La encontrarás en tus guardadas." : "Tus postulaciones no cambiaron.", action });
      if (kind === "remove") { if (next) setSelectedId(selected => selected === undefined || selected === id ? next : selected); setFocusTarget(next ?? "heading"); }
      if (kind === "undo") { setSelectedId(id); setFocusTarget(id); }
    } finally { locked.current = false; setBusy(undefined); }
  }
  /** Quitar keeps its place in the group: focus moves to the next row, or the previous one at the end. */
  function removeControl(item: SavedJobItem, group: SavedJobItem[]): RemoveControl {
    const index = group.findIndex(other => other.job_id === item.job_id);
    const next = (group[index + 1] ?? group[index - 1])?.job_id;
    return { pending: busy === item.job_id || busy === "bulk", describedBy: line ? STATUS_ID : undefined, onRemove: () => void mutate("remove", item.job_id, next) };
  }
  const selectableItems = selectable.map(entry => entry.item);
  function select(id: string) { setSelectedId(narrow && current?.item.job_id === id ? null : id); }
  function move(event: KeyboardEvent<HTMLButtonElement>, id: string) {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const ids = selectableItems.map(item => item.job_id);
    const next = ids[ids.indexOf(id) + (event.key === "ArrowDown" ? 1 : -1)];
    if (!next) return;
    root.current?.querySelector<HTMLElement>(`[data-pf-saved-vacancy="${next}"] [data-pf-saved-select]`)?.focus();
    // Narrow rows expand on activation only; arrows just move between them.
    if (!narrow) setSelectedId(next);
  }
  const row = (entry: Entry) => <QueueRow key={entry.item.job_id} entry={entry} narrow={narrow} now={now} selected={current?.item.job_id === entry.item.job_id}
    remove={removeControl(entry.item, selectableItems)} onSelect={() => select(entry.item.job_id)} onKeyDown={event => move(event, entry.item.job_id)} />;

  const status = line ? <ActionStatus id={STATUS_ID} tone={line.tone} text={line.text} action={line.action && <Button type="button" variant="link" className="min-h-10" disabled={!!busy} onClick={line.action.onClick}>{line.action.title}</Button>} /> : null;
  return <DashboardPageContent ref={root} data-pf-saved-vacancies-workspace width="screen-2xl" className={cn("gap-6", entrance === "on" && motion.enter)}>
    <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
      <div className="grid min-w-0 gap-1">
        <h2 ref={heading} tabIndex={-1} className="text-2xl font-semibold tracking-tight outline-none sm:text-[28px] sm:leading-9">Vacantes guardadas</h2>
        {list.data && <p className="text-sm text-muted-foreground tabular-nums">{summary(list.data.total, pending.length, closed.length)}</p>}
        {list.data && list.data.total >= 200 && <p className="max-w-prose text-sm text-muted-foreground">Llegaste al límite de 200 vacantes guardadas. Quita alguna para guardar otra.</p>}
      </div>
      {pending.length > 1 && <div className="flex w-full min-w-0 items-center gap-2 sm:w-auto">
        <ToggleGroup variant="segmented" aria-label="Ordenar por postularte" className="h-11! min-w-0 flex-1 max-sm:grid max-sm:grid-cols-3 sm:flex-none" value={[sort]} onValueChange={values => { if (values[0]) setSort(values[0] as SortKey); }}>
          {SORT_KEYS.map(key => <ToggleGroupItem key={key} value={key} className="min-w-0 max-sm:px-2!">{SORTS[key].label}</ToggleGroupItem>)}
        </ToggleGroup>
        <InfoPopover accessibleName="¿Cómo se ordena?" title="¿Cómo se ordena?"
          description="Arriba van las que siguen abiertas y aún no te postulas. Sugerido: primero las que llevan más días publicadas. Salario: el máximo publicado, de mayor a menor. Recientes: las que guardaste al último."
          footer="Bruto y neto no se comparan entre sí: primero van los salarios brutos, luego los netos y al final los que no indican cuál es o no se publicaron." />
      </div>}
    </header>
    {/* Mounted only with a result: an empty reserved slot (min-h-10) plus two gaps left ~80px above the groups. */}
    {status && !confirm && <ActionBar status={status}>{null}</ActionBar>}
    {!list.data ? list.isPending ? <LoadingSavedJobs /> : <StateCard icon={CircleAlert} tone="error" title="No pudimos cargar tus vacantes guardadas" description="Tus guardadas no cambiaron. Vuelve a consultar para verlas." primaryAction={{ label: list.isFetching ? "Cargando…" : "Reintentar", disabled: list.isFetching, onClick: () => void list.refetch() }} />
      : items.length === 0 ? <EmptySaved />
        : <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_400px]">
          <div className="flex min-w-0 flex-col gap-6">
            {(queue.length > 0 || applied.length > 0) && <section aria-labelledby="saved-queue" data-pf-saved-enter className={cn(CARD, "gap-1 px-1.5 pt-4 pb-1.5 sm:px-3 sm:pt-5 sm:pb-2", motion.rise)}>
              <div className="px-2.5 pb-2 sm:px-3">
                <h3 id="saved-queue" className="flex items-center gap-2 text-lg leading-7 font-semibold">Postúlate primero <Badge variant="neutral">{queue.length}</Badge></h3>
                {queue.length > 0 && <p className="mt-0.5 text-xs text-muted-foreground">{queue.length > 1 ? SORTS[sort].caption : "Sigue abierta y aún no te postulas."}</p>}
              </div>
              {queue.length > 0 ? <ol aria-label={`Por postularte, ${SORTS[sort].caption.toLowerCase()}`} className="flex flex-col gap-1">{queue.map(row)}</ol>
                : <SectionEmpty icon={CircleCheck} tone="empty" headingLevel={4} title="Ya te postulaste a todas tus guardadas" description="Sigue su avance en Postulaciones o guarda nuevas vacantes." primaryAction={{ label: "Explorar vacantes", href: "/vacantes" }} />}
            </section>}
            {applied.length > 0 && <section aria-labelledby="saved-applied" data-pf-saved-enter style={{ "--d": 2 } as CSSProperties} className={cn(CARD, "gap-1 px-1.5 pt-4 pb-1.5 sm:px-3 sm:pt-5 sm:pb-2", motion.rise)}>
              <div className="flex flex-wrap items-start justify-between gap-x-3 px-2.5 pb-2 sm:px-3">
                <h3 id="saved-applied" className="flex items-center gap-2 text-lg leading-7 font-semibold">Ya te postulaste <Badge variant="neutral">{applied.length}</Badge></h3>
                <Link href="/candidato/postulaciones" className={cn(buttonVariants({ variant: "ghost" }), "-mt-1.5 -mr-1 min-h-10 text-muted-foreground")}>Ver postulaciones</Link>
              </div>
              <ul aria-label="Ya te postulaste" className="flex flex-col gap-1">{selectable.slice(queue.length).map(row)}</ul>
            </section>}
            {closed.length > 0 && <Accordion defaultValue={[]} className={cn(CARD, "px-4 sm:px-5")}><AccordionItem value="closed" className="border-0">
              <AccordionTrigger className="min-h-14 items-center text-sm font-semibold hover:no-underline">Ya no disponibles <Badge variant="neutral">{closed.length}</Badge></AccordionTrigger>
              <AccordionContent>
                <ul aria-label="Ya no disponibles" className="flex flex-col divide-y">{closed.map(item => <ClosedRow key={item.job_id} item={item} remove={removeControl(item, closed)} />)}</ul>
                <ActionBar status={null}><Button ref={bulkButton} type="button" variant="ghost" className="mt-2 min-h-10 max-w-full whitespace-normal text-left" disabled={!!busy} onClick={() => setConfirm(true)}>Quitar las que ya no están disponibles</Button></ActionBar>
              </AccordionContent>
            </AccordionItem></Accordion>}
          </div>
          {!narrow && current && <VacancyPreview entry={current} now={now} remove={removeControl(current.item, selectableItems)} />}
        </div>}
    <ConfirmActionDialog open={confirm} onOpenChange={setConfirm} onConfirm={() => void mutate("bulk")} finalFocus={bulkButton} icon={Bookmark} tone="destructive" title="¿Quitar las vacantes no disponibles?" description="Se quitarán de tus guardadas. Tus postulaciones no cambian. Para volver a guardarlas tendrás que encontrarlas de nuevo." confirmLabel="Quitar vacantes" pendingLabel="Quitando…" pending={busy === "bulk"}>
      <p>{plural(closed.length, "vacante no disponible", "vacantes no disponibles")}</p>
      {line?.tone === "error" && status}
    </ConfirmActionDialog>
  </DashboardPageContent>;
}
