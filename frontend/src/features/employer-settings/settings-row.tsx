import type { ReactNode } from "react";
import { Clock3 } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "cn";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from "@/components/ui/item";

/** A titled card of setting rows (artboard `settings-redesign/02`): the heading names the group, each row is one `li`. */
export function SettingsGroup({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={`${id}-heading`}>
      <h2 id={`${id}-heading`} className="px-2 pb-2 font-heading text-xs font-semibold tracking-wide text-muted-foreground">{title}</h2>
      <Card className="gap-0 py-0">
        <ItemGroup role="presentation" className="gap-0"><ul className="flex w-full flex-col divide-y divide-border/60">{children}</ul></ItemGroup>
      </Card>
    </section>
  );
}

/**
 * One setting: icon tile, title and description on the left; the current value and the action on the right (below the text on phones).
 * `soon` rows are plain text with the reason «Próximamente» visible: there is no control to disable.
 */
export function SettingsRow({ id, icon: Icon, title, description, value, note, soon = false, children }: {
  /** Names the title, so the row's button can be described by it. */
  id: string;
  icon: LucideIcon;
  title: string;
  description: string;
  /** What is set today, shown before the action. */
  value?: ReactNode;
  /** A status line under the description (loading, load error). */
  note?: ReactNode;
  soon?: boolean;
  /** The action. */
  children?: ReactNode;
}) {
  const hasActions = value !== undefined || children !== undefined || soon;
  return (
    <li className="min-w-0">
      <Item className="min-h-18 items-center rounded-none px-4 py-3.5 md:px-5 max-md:items-start">
        <ItemMedia>
          <span aria-hidden="true" className={cn("grid size-10 place-items-center rounded-[14px] [&_svg]:size-5", soon ? "bg-muted text-muted-foreground" : "bg-primary/10 text-primary-text")}><Icon /></span>
        </ItemMedia>
        <ItemContent className="min-w-44">
          <ItemTitle id={id} className={soon ? "text-muted-foreground" : undefined}>{title}</ItemTitle>
          {/* Phones show the whole text (artboard); the two-line clamp stays from the tablet up. */}
          <ItemDescription className="max-md:line-clamp-none">{description}</ItemDescription>
          {note}
        </ItemContent>
        {hasActions && <ItemActions className="w-full justify-between gap-3 max-md:pl-13 md:ml-auto md:w-auto md:justify-end [&>[data-slot=button]]:max-md:min-h-11 [&>[data-slot=button]]:max-md:flex-1">
          {value !== undefined && <span className="text-sm font-medium text-foreground md:max-w-60 md:text-right">{value}</span>}
          {soon && <Badge variant="neutral"><Clock3 aria-hidden="true" />Próximamente</Badge>}
          {children}
        </ItemActions>}
      </Item>
    </li>
  );
}
