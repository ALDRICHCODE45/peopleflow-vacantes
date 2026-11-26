"use client";
import { useId, useState } from "react";
import { TriangleAlert } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { dayKey, dayLabel, inboxSummary } from "../copy";
import type { NotificationGroup, NotificationState } from "../model";
import { InboxError, InboxFirstUse, InboxSkeleton, InboxUpToDate } from "./inbox-states";
import { NotificationRow } from "./notification-row";
import { useInboxPages, type InboxPages } from "./use-inbox-pages";

type Props = {
  /** Last count the bell knows, shown while this sheet cannot tell. */
  knownUnread: number | null;
  onUnreadCount: (unread: number) => void;
  /** Following any link closes the sheet. */
  onNavigate: () => void;
};

/**
 * Read-only company inbox inside the bell's sheet (design 07 over the 02 sheet): title and summary, tabs
 * «No leídas» (default) and «Todas», pinned «Requiere atención», day sections and cursor paging.
 * T3.5 seams: the «Filtrar» button joins the tab row, «Marcar todo como leído» and «Preferencias» the footer.
 */
export function NotificationInbox({ knownUnread, onUnreadCount, onNavigate }: Props) {
  const [tab, setTab] = useState<NotificationState>("unread");
  const { view, retry, loadMore } = useInboxPages(tab, onUnreadCount);
  const ready = view.status === "ready" ? view.pages : null;
  const summary = inboxSummary({
    loading: view.status === "loading",
    unread: ready?.unread ?? knownUnread,
    attention: ready?.attentionTotal ?? null,
  });

  const body = view.status === "loading" ? <InboxSkeleton />
    : view.status === "error" ? <InboxError onRetry={retry} />
    : <InboxList pages={view.pages} tab={tab} more={view.more} onMore={loadMore} onShowAll={() => setTab("all")} onNavigate={onNavigate} />;
  const panel = "min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pt-1 pb-2";

  return <>
    <SheetHeader className="gap-0.5 px-6 pt-5 pr-18 pb-1 max-sm:px-4 max-sm:pt-3.5 max-sm:pr-16">
      <SheetTitle>Notificaciones</SheetTitle>
      <SheetDescription>{summary}</SheetDescription>
    </SheetHeader>
    <Tabs value={tab} onValueChange={value => setTab(value as NotificationState)} className="min-h-0 flex-1 gap-0">
      <div className="flex shrink-0 items-center gap-2 border-b border-border/60 px-6 pt-2.5 pb-3 max-sm:px-4">
        <TabsList aria-label="Filtrar notificaciones" className="h-auto min-h-9">
          <TabsTrigger value="unread" className="min-h-8 max-sm:min-h-9">No leídas{ready && ready.unread > 0 && <Badge variant="secondary">{ready.unread}</Badge>}</TabsTrigger>
          <TabsTrigger value="all" className="min-h-8 max-sm:min-h-9">Todas</TabsTrigger>
        </TabsList>
        {/* T3.5 seam: «Filtrar» (type + vacancy panel) goes at the end of this row. */}
      </div>
      <TabsContent value="unread" className={panel}>{tab === "unread" && body}</TabsContent>
      <TabsContent value="all" className={panel}>{tab === "all" && body}</TabsContent>
    </Tabs>
    {/* T3.5 / stage 2 seam: footer with «Preferencias» (needs /empresa/configuracion/notificaciones) and «Marcar todo como leído». */}
  </>;
}

function InboxList({ pages, tab, more, onMore, onShowAll, onNavigate }: {
  pages: InboxPages; tab: NotificationState; more: "idle" | "loading" | "error";
  onMore: () => void; onShowAll: () => void; onNavigate: () => void;
}) {
  if (pages.attention.length === 0 && pages.items.length === 0) {
    return tab === "unread" ? <InboxUpToDate onShowAll={onShowAll} /> : <InboxFirstUse />;
  }
  return <>
    {pages.attention.length > 0 && <Attention groups={pages.attention} total={pages.attentionTotal} onNavigate={onNavigate} />}
    {byDay(pages.items).map(([key, groups]) => <DaySection key={key} day={key} groups={groups} onNavigate={onNavigate} />)}
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

function Attention({ groups, total, onNavigate }: { groups: NotificationGroup[]; total: number; onNavigate: () => void }) {
  const id = useId();
  return <section aria-labelledby={id} className="my-1.5 rounded-2xl bg-status-review/6 pt-0.5 pb-1">
    <h3 id={id} className="flex items-center justify-between gap-2 px-2.5 pt-2.5 pb-1 text-xs font-semibold text-foreground">
      <span className="flex items-center gap-1.5"><TriangleAlert aria-hidden="true" className="size-3.5 text-status-review" />Requiere atención</span>
      <span className="tabular-nums">{total}</span>
    </h3>
    <ul className="grid gap-0.5">{groups.map(group => <NotificationRow key={group.group_key} group={group} onNavigate={onNavigate} />)}</ul>
  </section>;
}

function DaySection({ day, groups, onNavigate }: { day: string; groups: NotificationGroup[]; onNavigate: () => void }) {
  const id = useId();
  return <section aria-labelledby={id}>
    <h3 id={id} className="sticky top-0 z-[2] bg-popover px-2.5 pt-2.5 pb-1 text-xs font-semibold text-muted-foreground">{dayLabel(day)}</h3>
    <ul className="grid gap-0.5">{groups.map(group => <NotificationRow key={group.group_key} group={group} onNavigate={onNavigate} />)}</ul>
  </section>;
}
