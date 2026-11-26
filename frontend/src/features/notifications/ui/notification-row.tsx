"use client";
import { useId, useState } from "react";
import Link from "next/link";
import {
  Bell, ChevronDown, ChevronRight, ClipboardCheck, Clock, ClockAlert, Hourglass, UserCheck, UserPlus, Users, type LucideIcon,
} from "lucide-react";
import { cn } from "cn";

import { Badge } from "@/components/ui/badge";
import { relativeTime } from "@/features/org-candidates/relative-time";
import {
  describeNotification, notificationTarget, participationHref, sampleToggleLabel, type NotificationIcon, type NotificationTone,
} from "../copy";
import type { NotificationGroup } from "../model";

const ICONS: Record<NotificationIcon, LucideIcon> = {
  application: UserPlus, "due-soon": Clock, overdue: ClockAlert, assignment: UserCheck, team: Users,
  "psychometric-done": ClipboardCheck, "psychometric-pending": Hourglass, generic: Bell,
};
/** Icon tile tones of design 07 (`tone-pr|rv|dg|in|ok|mu`): token text on an 11 % wash of itself. */
const TONES: Record<NotificationTone, string> = {
  primary: "bg-primary/10 text-primary",
  review: "bg-status-review/10 text-status-review",
  danger: "bg-status-danger/10 text-status-danger",
  info: "bg-status-info/10 text-status-info",
  success: "bg-status-success/10 text-status-success",
  muted: "bg-muted text-muted-foreground",
};

const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join("").toUpperCase();

/**
 * One inbox row (design 07 `ntRow`): type tile, title (with «No leída.» for screen readers), subtitle and a meta line
 * with the urgency badge, relative time and destination. Rows without a link stay plain text. Grouped rows with a
 * sample expand to the candidates, each linking to its participation.
 */
export function NotificationRow({ group, onNavigate }: { group: NotificationGroup; onNavigate: () => void }) {
  const [open, setOpen] = useState(false);
  const subId = useId();
  const copy = describeNotification(group);
  const target = notificationTarget(group.link);
  const Icon = ICONS[copy.icon];
  const unread = !group.read;
  const jobId = group.job?.id ?? (group.link && "job_id" in group.link ? group.link.job_id : null);
  const sample = jobId && group.count > 1 && group.sample.length > 1 ? group.sample : [];

  const content = <>
    <span aria-hidden="true" className={cn("grid size-9 place-items-center rounded-xl", TONES[copy.tone])}><Icon className="size-[18px]" /></span>
    <span className="grid min-w-0 gap-0.5">
      <span className={cn("break-words", unread ? "font-semibold" : "font-medium")}>
        {unread && <span className="sr-only">No leída. </span>}{copy.title}
      </span>
      {copy.subtitle && <span className="break-words text-muted-foreground">{copy.subtitle}</span>}
      <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
        {copy.urgency && <Badge variant={copy.urgency.variant}>{copy.urgency.variant === "danger" ? <ClockAlert aria-hidden="true" /> : <Clock aria-hidden="true" />}{copy.urgency.label}</Badge>}
        <span>{relativeTime(group.latest_at)}</span>
        {target && <><span aria-hidden="true">·</span><span className="inline-flex items-center gap-0.5">{target.destination}<ChevronRight aria-hidden="true" className="size-3" /></span></>}
      </span>
    </span>
  </>;
  const rowClass = "grid min-w-0 grid-cols-[36px_minmax(0,1fr)] items-start gap-3 rounded-[14px] py-2.5 pr-3 pl-3.5 text-left text-sm text-foreground";

  return <li className="relative grid rounded-[14px] hover:bg-muted/70">
    {unread && <span aria-hidden="true" className="absolute top-6 left-1 size-1.5 rounded-full bg-primary" />}
    {target
      ? <Link href={target.href} onClick={onNavigate} className={cn(rowClass, "outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset")}>{content}</Link>
      : <div className={rowClass}>{content}</div>}
    {/* T3.5 seam: «Marcar como leída» (per group) sits at the end of this row. */}
    {sample.length > 0 && jobId && <>
      <button type="button" aria-expanded={open} aria-controls={open ? subId : undefined} onClick={() => setOpen(value => !value)}
        className="mb-1.5 ml-[62px] inline-flex min-h-8 items-center gap-1 justify-self-start rounded-xl px-2 text-[13px] font-medium text-primary outline-hidden hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring">
        {sampleToggleLabel({ count: group.count, shown: sample.length }, open)}
        <ChevronDown aria-hidden="true" className={cn("size-3.5 transition-transform motion-reduce:transition-none", open && "rotate-180")} />
      </button>
      {open && <ul id={subId} className="mr-2 mb-2 ml-[62px] grid border-l-2 border-border pl-2">
        {sample.map(candidate => {
          const name = candidate.name?.trim() || "Candidato";
          return <li key={candidate.participation_id}>
            <Link href={participationHref(jobId, candidate.participation_id)} onClick={onNavigate}
              className="flex min-h-10 items-center gap-2.5 rounded-xl px-2 py-1 text-sm text-foreground outline-hidden hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring">
              <span aria-hidden="true" className="grid size-6 place-items-center rounded-full bg-muted text-[10px] font-medium">{initials(name)}</span>
              <span>{name}</span>
            </Link>
          </li>;
        })}
      </ul>}
    </>}
  </li>;
}
