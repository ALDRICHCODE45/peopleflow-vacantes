"use client";
import type { MouseEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronRight } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { accentAvatar } from "@/lib/accent";
import { cn } from "@/lib/utils";
import { initials } from "@/features/pipeline-movement/pipeline-presentation";
import { CellView, COLUMNS } from "./recruiter-columns";
import type { Drill } from "./recruiter-detail/parts";
import { COLUMN_GROUPS, COLUMN_IDS, type ColumnId } from "./recruiter-view";
import { number, personName, type RecruiterCard } from "./model";
import { sortLabel, type RecruiterSort, type SortKey } from "./sorting";

type Props = {
  /** Already in the order of `sort`: the page sorts so the table, the cards and the «Orden: …» line agree. */
  items: RecruiterCard[]; sort: RecruiterSort; hidden: ColumnId[];
  onSort: (key: SortKey) => void;
  /** A person's recruiter page (it remembers the table, S4). */
  href: (card: RecruiterCard) => string;
  drill: Drill;
};

const FIRST_WIDTH = 184;
const CHEVRON_WIDTH = 44;
/** Sticky offsets: the group row is `h-10`, so the column row sticks right below it. */
const GROUP_ROW = "h-10";
const STICKY_HEAD = "sticky z-20 bg-card";
const STICKY_FIRST = "sticky left-0 z-10 bg-card shadow-[inset_-1px_0_0_var(--border)]";

const NAME_LINK = "rounded-sm text-sm leading-5 font-medium text-foreground underline-offset-4 outline-none [overflow-wrap:anywhere] hover:underline focus-visible:underline focus-visible:ring-2 focus-visible:ring-ring";
function Person({ card, href }: { card: RecruiterCard; href: string }) {
  const name = personName(card);
  return <div className="flex min-w-0 items-start gap-3">
    <Avatar className="size-10 shrink-0"><AvatarFallback className={accentAvatar}>{initials(name)}</AvatarFallback></Avatar>
    <div className="grid min-w-0 flex-1 justify-items-start gap-0.5">
      <Link href={href} className={NAME_LINK}>{name}</Link>
      {card.former_member ? <Badge variant="neutral" title="Ya no pertenece a la empresa; su historial se conserva">Ex miembro</Badge>
        : <span className="text-[12.5px] leading-[17px] text-muted-foreground">{`${number.format(card.vacancies.as_responsible)} como responsable`}</span>}
    </div>
  </div>;
}
const OpenCard = ({ card, href }: { card: RecruiterCard; href: string }) =>
  <Button variant="ghost" size="icon" className="size-10 text-muted-foreground" nativeButton={false} role="link" aria-label={`Ver ficha de ${personName(card)}`} render={<Link href={href} />}><ChevronRight aria-hidden="true" /></Button>;

/** A header that sorts: a button inside the `th`, which carries `aria-sort`; the label wraps rather than being cut. */
function SortButton({ id, label, sort, onSort, numeric }: { id: SortKey; label: string; sort: RecruiterSort; onSort: Props["onSort"]; numeric?: boolean }) {
  const Icon = sort.key !== id ? ArrowUpDown : sort.direction === "ascending" ? ArrowUp : ArrowDown;
  return <Button type="button" variant="ghost" size="sm" onClick={() => onSort(id)}
    className={cn("-mx-2 h-auto min-h-10 max-w-full hyphens-auto py-1 leading-tight whitespace-normal", numeric ? "ml-auto justify-end text-right" : "text-left", sort.key === id ? "text-foreground" : "text-muted-foreground")}>
    {label}<Icon aria-hidden="true" data-icon="inline-end" />
  </Button>;
}
const ariaSort = (sort: RecruiterSort, id: SortKey) => sort.key === id ? sort.direction : undefined;

/**
 * The full recruiter table (S2, artboard `recruiter-table-redesign/01`): from `md` a table with grouped headers, the person
 * and both header rows sticky inside one scroll region (the eight columns fit at 1440 without scrolling sideways; cells wrap,
 * extending the audit-table exception of `design/system.md`); below `md` one card per person with the same groups, no
 * sideways scroll (rule 14).
 */
export function RecruiterTable({ items, sort, hidden, onSort, href, drill }: Props) {
  const router = useRouter();
  const visible = COLUMN_IDS.filter(id => !hidden.includes(id));
  const groups = COLUMN_GROUPS.map(group => ({ ...group, columns: group.columns.filter(id => visible.includes(id)) })).filter(group => group.columns.length > 0);
  const starts = new Set(groups.map(group => group.columns[0] as ColumnId));
  const minWidth = FIRST_WIDTH + CHEVRON_WIDTH + visible.reduce((sum, id) => sum + COLUMNS[id].width, 0);
  const open = (event: MouseEvent, card: RecruiterCard) => { if (!(event.target as HTMLElement).closest("a, button")) router.push(href(card)); };

  return <>
    <ul aria-label="Reclutadores" className="flex flex-col divide-y overflow-hidden rounded-3xl bg-card shadow-sm ring-1 ring-foreground/5 md:hidden dark:ring-foreground/10">
      {items.map(card => <li key={card.user_id} className="p-4">
        <article className="flex flex-col gap-4">
          <div className="flex items-start gap-2"><div className="min-w-0 flex-1"><Person card={card} href={href(card)} /></div><OpenCard card={card} href={href(card)} /></div>
          {groups.length === 0 ? <p className="text-xs text-muted-foreground">Todas las columnas están ocultas. Elige cuáles ver en «Columnas».</p>
            : groups.map(group => <div key={group.id} role="group" aria-label={group.label} className="flex flex-col gap-2">
              <p className="text-xs font-semibold text-muted-foreground">{group.label}</p>
              <dl className={cn("grid gap-x-4 gap-y-3", group.id === "load" ? "grid-cols-3" : "grid-cols-2")}>
                {group.columns.map(id => <div key={id} className={cn("min-w-0", id === "on_time" && "col-span-full")}>
                  <dt className="text-xs text-muted-foreground">{COLUMNS[id].label}</dt>
                  <dd className="mt-0.5 min-w-0 text-sm"><CellView parts={COLUMNS[id].cell({ card, drill })} /></dd>
                </div>)}
              </dl>
            </div>)}
        </article>
      </li>)}
    </ul>
    <Card className="hidden gap-0 overflow-hidden p-0 md:flex">
      <div role="region" aria-label="Tabla con desplazamiento horizontal" tabIndex={0}
        className="max-h-[max(480px,calc(100dvh-120px))] overflow-auto outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary-text">
        <table className="w-full table-fixed border-separate border-spacing-0 text-sm" style={{ minWidth }}>
          <caption className="sr-only">{`Reclutadores del periodo. ${sortLabel(sort)}`}</caption>
          <colgroup><col style={{ width: FIRST_WIDTH }} />{visible.map(id => <col key={id} style={{ width: COLUMNS[id].width }} />)}<col style={{ width: CHEVRON_WIDTH }} /></colgroup>
          <TableHeader>
            <TableRow className="border-0 hover:bg-transparent">
              <TableHead scope="col" rowSpan={2} aria-sort={ariaSort(sort, "name")} className={cn(STICKY_HEAD, "top-0 left-0 z-30 border-b px-4 align-bottom shadow-[inset_-1px_0_0_var(--border)]")}>
                <SortButton id="name" label="Reclutador" sort={sort} onSort={onSort} />
              </TableHead>
              {groups.map(group => <TableHead key={group.id} scope="colgroup" colSpan={group.columns.length} className={cn(STICKY_HEAD, GROUP_ROW, "top-0 border-b px-2 font-semibold shadow-[inset_1px_0_0_var(--border)]")}>{group.label}</TableHead>)}
              <TableHead scope="col" rowSpan={2} className={cn(STICKY_HEAD, "top-0 right-0 z-30 border-b p-0")}><span className="sr-only">Ver ficha</span></TableHead>
            </TableRow>
            <TableRow className="border-0 hover:bg-transparent">
              {groups.flatMap(group => group.columns).map(id => <TableHead key={id} scope="col" aria-sort={ariaSort(sort, id)}
                className={cn(STICKY_HEAD, "top-10 border-b px-2 align-bottom", starts.has(id) && "shadow-[inset_1px_0_0_var(--border)]")}>
                <SortButton id={id} label={COLUMNS[id].label} sort={sort} onSort={onSort} numeric />
              </TableHead>)}
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map(card => <TableRow key={card.user_id} className="group/row cursor-pointer hover:bg-transparent [&:last-child>*]:border-b-0" onClick={event => open(event, card)}>
              <TableHead scope="row" className={cn(STICKY_FIRST, "h-auto border-b px-4 py-4 align-top font-normal whitespace-normal group-hover/row:bg-muted")}><Person card={card} href={href(card)} /></TableHead>
              {groups.flatMap(group => group.columns).map(id => <TableCell key={id} className={cn("border-b px-2 py-4 text-right align-top whitespace-normal group-hover/row:bg-muted", starts.has(id) && "shadow-[inset_1px_0_0_var(--border)]")}>
                <CellView parts={COLUMNS[id].cell({ card, drill })} className="justify-items-end text-right" />
              </TableCell>)}
              <TableCell className={cn("sticky right-0 z-10 border-b bg-card p-0 align-top group-hover/row:bg-muted")}><div className="grid h-full place-items-center pt-3"><OpenCard card={card} href={href(card)} /></div></TableCell>
            </TableRow>)}
          </TableBody>
        </table>
      </div>
    </Card>
  </>;
}
