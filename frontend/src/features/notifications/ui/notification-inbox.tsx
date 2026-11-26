"use client";
import { useCallback, useId, useMemo, useRef, useState } from "react";
import { TriangleAlert } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { dayKey, dayLabel, filterSummary, filterTypes, inboxSummary, noResultsDescription } from "../copy";
import type { NotificationGroup, NotificationState } from "../model";
import { InboxFilter, type InboxFilterValue } from "./inbox-filter";
import { InboxError, InboxFirstUse, InboxNoResults, InboxSkeleton, InboxUpToDate } from "./inbox-states";
import { InboxFilterSummary, InboxFooter, InboxMarkStatus } from "./inbox-status";
import { NotificationRow } from "./notification-row";
import { useInboxMarks } from "./use-inbox-marks";
import { useInboxPages, type InboxPages } from "./use-inbox-pages";

type Props = {
  /** Last count the bell knows, shown while this sheet cannot tell. */
  knownUnread: number | null;
  onUnreadCount: (unread: number) => void;
  /** Following any link closes the sheet. */
  onNavigate: () => void;
};
type RowActions = { onNavigate: () => void; onOpen: (group: NotificationGroup) => void; onMark: (group: NotificationGroup) => void };

const noFilters: InboxFilterValue = { groups: [], jobs: [] };

/**
 * Company inbox inside the bell's sheet (design 07 over the 02 sheet): title and summary, tabs «No leídas» (default)
 * and «Todas» with «Filtrar» (type + vacancy popover) and a one-line summary of active filters, pinned «Requiere
 * atención», day sections, cursor paging, per-row «Marcar como leída» and the «Marcar todo como leído» footer with
 * «Deshacer». «Preferencias» joins the footer in stage 2 (needs /empresa/configuracion/notificaciones).
 */
export function NotificationInbox({ knownUnread, onUnreadCount, onNavigate }: Props) {
  const [tab, setTab] = useState<NotificationState>("unread");
  const [filter, setFilter] = useState<InboxFilterValue>(noFilters);
  const filterButton = useRef<HTMLButtonElement>(null);
  const filters = useMemo(() => ({ types: filterTypes(filter.groups), jobIds: filter.jobs.map(job => job.id) }), [filter]);
  const { view, retry, reload, loadMore, markLocal } = useInboxPages(tab, filters, onUnreadCount);
  const ready = view.status === "ready" ? view.pages : null;
  const marks = useInboxMarks({ filters, loadedAt: ready?.loadedAt ?? null, onUnreadCount, markLocal, reload });
  const { clearStatus } = marks;
  const summary = inboxSummary({
    loading: view.status === "loading",
    unread: ready?.unread ?? knownUnread,
    attention: ready?.attentionTotal ?? null,
  });
  const filterText = filterSummary(filter.groups, filter.jobs);

  const changeTab = (value: NotificationState) => { setTab(value); clearStatus(); };
  const changeFilter = useCallback((value: InboxFilterValue) => { setFilter(value); clearStatus(); }, [clearStatus]);
  const clearFilters = () => { changeFilter(noFilters); filterButton.current?.focus(); };
  const rowActions: RowActions = { onNavigate, onOpen: marks.openGroup, onMark: group => void marks.markGroup(group) };

  const body = view.status === "loading" ? <InboxSkeleton />
    : view.status === "error" ? <InboxError onRetry={retry} />
    : <InboxList pages={view.pages} tab={tab} more={view.more} onMore={loadMore} onShowAll={() => changeTab("all")}
        noResults={filterText ? { description: noResultsDescription(filterText, tab), onClear: clearFilters } : null} actions={rowActions} />;
  const panel = "min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pt-1 pb-2";
  const results = ready && !ready.nextCursor ? ready.attention.length + ready.items.length : null;

  return <>
    <SheetHeader className="gap-0.5 px-6 pt-5 pr-18 pb-1 max-sm:px-4 max-sm:pt-3.5 max-sm:pr-16">
      <SheetTitle>Notificaciones</SheetTitle>
      <SheetDescription>{summary}</SheetDescription>
    </SheetHeader>
    <Tabs value={tab} onValueChange={value => changeTab(value as NotificationState)} className="min-h-0 flex-1 gap-0">
      <div className="flex shrink-0 items-center gap-2 border-b border-border/60 px-6 pt-2.5 pb-3 max-sm:px-4">
        <TabsList aria-label="Filtrar notificaciones" className="h-auto min-h-9">
          <TabsTrigger value="unread" className="min-h-8 max-sm:min-h-9">No leídas{ready && ready.unread > 0 && <Badge variant="secondary">{ready.unread}</Badge>}</TabsTrigger>
          <TabsTrigger value="all" className="min-h-8 max-sm:min-h-9">Todas</TabsTrigger>
        </TabsList>
        <InboxFilter tab={tab} value={filter} onChange={changeFilter} results={results} triggerRef={filterButton} />
      </div>
      {filterText && <InboxFilterSummary summary={filterText} onClear={clearFilters} />}
      <InboxMarkStatus status={marks.status} busy={marks.busy} onUndo={() => void marks.undo()} />
      <TabsContent value="unread" className={panel}>{tab === "unread" && body}</TabsContent>
      <TabsContent value="all" className={panel}>{tab === "all" && body}</TabsContent>
    </Tabs>
    {ready && <InboxFooter unread={ready.unread} busy={marks.busy} onMarkAll={() => void marks.markAll()} />}
  </>;
}

function InboxList({ pages, tab, more, onMore, onShowAll, noResults, actions }: {
  pages: InboxPages; tab: NotificationState; more: "idle" | "loading" | "error";
  onMore: () => void; onShowAll: () => void; noResults: { description: string; onClear: () => void } | null; actions: RowActions;
}) {
  if (pages.attention.length === 0 && pages.items.length === 0) {
    if (noResults) return <InboxNoResults {...noResults} />;
    return tab === "unread" ? <InboxUpToDate onShowAll={onShowAll} /> : <InboxFirstUse />;
  }
  return <>
    {pages.attention.length > 0 && <Attention groups={pages.attention} total={pages.attentionTotal} actions={actions} />}
    {byDay(pages.items).map(([key, groups]) => <DaySection key={key} day={key} groups={groups} actions={actions} />)}
    {more === "error" && <p role="alert" className="px-3.5 pt-2 text-sm text-status-danger">No pudimos cargar más notificaciones.</p>}
    {pages.nextCursor && <div className="flex justify-center px-2 pt-2 pb-1">
      <Button type="button" variant="outline" className="min-h-10" disabled={more === "loading"} aria-busy={more === "loading" || undefined} onClick={onMore}>Cargar más</Button>
    </div>}
  </>;
}

/** Consecutive groups of the same Mexico City day, in API order (newest first). */
function byDay(groups: NotificationGroup[]): [string, NotificationGroup[]][] {
  const days: [string, NotificationGroup[]][] = [];
  for (const group of groups) {
    const key = dayKey(group.latest_at);
    const last = days.at(-1);
    if (last?.[0] === key) last[1].push(group);
    else days.push([key, [group]]);
  }
  return days;
}

function Attention({ groups, total, actions }: { groups: NotificationGroup[]; total: number; actions: RowActions }) {
  const id = useId();
  return <section aria-labelledby={id} className="my-1.5 rounded-2xl bg-status-review/6 pt-0.5 pb-1">
    <h3 id={id} className="flex items-center justify-between gap-2 px-2.5 pt-2.5 pb-1 text-xs font-semibold text-foreground">
      <span className="flex items-center gap-1.5"><TriangleAlert aria-hidden="true" className="size-3.5 text-status-review" />Requiere atención</span>
      <span className="tabular-nums">{total}</span>
    </h3>
    <ul className="grid gap-0.5">{groups.map(group => <NotificationRow key={group.group_key} group={group} {...actions} />)}</ul>
  </section>;
}

function DaySection({ day, groups, actions }: { day: string; groups: NotificationGroup[]; actions: RowActions }) {
  const id = useId();
  return <section aria-labelledby={id}>
    <h3 id={id} className="sticky top-0 z-[2] bg-popover px-2.5 pt-2.5 pb-1 text-xs font-semibold text-muted-foreground">{dayLabel(day)}</h3>
    <ul className="grid gap-0.5">{groups.map(group => <NotificationRow key={group.group_key} group={group} {...actions} />)}</ul>
  </section>;
}
