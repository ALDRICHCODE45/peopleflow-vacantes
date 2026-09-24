import { CalendarClock, Download, Ellipsis, FileText, FileType2, HardDrive, Languages, RefreshCw, Star, Upload } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";

import { CV_LANGUAGE_LABELS, summarizeCvs } from "./portfolio-model";
import type { CandidateCv } from "./portfolio-model";

/**
 * Props-only, server-renderable CV metadata inventory for `/candidato/cvs`.
 * Every header fact, card and placeholder affordance derives from `cvs`; the
 * surface owns no fixture, network, persistence, navigation, form, timer or
 * callback, and CDP-08B supplies the frozen metadata at the route boundary.
 * Composition stays shadcn-first: one installed Card per CV with its native
 * header/content anatomy, a semantic role Badge, one installed DropdownMenu of
 * inert document actions in the header CardAction, contextual lucide icons and the
 * installed Empty state for the unreachable empty branch. The menu trigger is a
 * disclosure control: it opens choices, it never carries capability.
 */
export type CvWorkspaceProps = Readonly<{ cvs: readonly CandidateCv[] }>;

/** Product-facing summary for the true-empty branch. */
const EMPTY_SUMMARY = "Todavía no tienes CVs.";

/** Deterministic Spanish date (UTC) and deterministic KB/MB size text. */
const DATE_FORMAT = new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
const DECIMAL_FORMAT = new Intl.NumberFormat("es-MX", { maximumFractionDigits: 1 });
const formatDate = (value: string): string => DATE_FORMAT.format(new Date(value));
const formatFileSize = (bytes: number): string => bytes >= 1024 * 1024 ? `${DECIMAL_FORMAT.format(bytes / 1024 / 1024)} MB` : `${DECIMAL_FORMAT.format(Math.round(bytes / 1024))} KB`;
/** Natural Spanish count: singular only for exactly one. */
const countLabel = (count: number, singular: string, plural: string): string => `${count} ${count === 1 ? singular : plural}`;

/** Quiet fact term: the contextual icon never competes with the value it labels. */
const META = "text-[12.5px] font-medium text-muted-foreground";
/** Card facts: one column on mobile, the approved two-column row from `sm`. */
const FACTS = "grid grid-cols-1 gap-x-6 gap-y-4 text-sm sm:grid-cols-2";
/** The sole direct document action stays an enabled, inert Button with the 40px target. */
const ACTION = "min-h-10";
/** 40px disclosure trigger: it only reveals choices, so it stays enabled. */
const TRIGGER = "size-10";
/** Menu item at or above the 40px target: enabled, focusable and inert. */
const MENU_ITEM = "min-h-10";
/** One column on mobile, the approved two-column document grid from `lg`. */
const GRID = "grid grid-cols-1 items-start gap-4 lg:grid-cols-2";
/** Circular document medallion: the file icon anchors the identity of the card. */
const MEDALLION = "grid size-11 shrink-0 place-items-center rounded-full bg-primary/10 text-primary";

/**
 * Deterministic order over a copy of the props: the primary CV first, then
 * `updatedAt` descending, with the id as the stable tie. The input is untouched.
 */
function orderCvs(cvs: readonly CandidateCv[]): readonly CandidateCv[] {
  return [...cvs].sort((a, b) => {
    if (a.isPrimary !== b.isPrimary) return a.isPrimary ? -1 : 1;
    const byUpdated = Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
    if (byUpdated !== 0) return byUpdated;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/** Derived header summary: natural count plus the exact primary label and filename. */
function summaryText(total: number, primary: CandidateCv | undefined): string {
  if (total === 0) return EMPTY_SUMMARY;
  if (primary === undefined) return `Tienes ${countLabel(total, "CV", "CVs")}, pero ninguno está marcado como principal.`;
  return `Tienes ${countLabel(total, "CV", "CVs")}. Tu CV principal es «${primary.label}» (${primary.fileName}).`;
}

/**
 * The role fact as an installed Badge: `Principal` uses the filled default tone
 * and `Secundario` the outline one, so the Spanish word carries the meaning and
 * the tone only reinforces it. Roles never rely on color alone.
 */
function RoleBadge({ isPrimary }: { readonly isPrimary: boolean }) {
  return <Badge variant={isPrimary ? "default" : "outline"}>{isPrimary ? "Principal" : "Secundario"}</Badge>;
}

/** One labelled fact: a functional icon with the quiet term, then the value. */
function FactLabel({ icon: Icon, children }: { readonly icon: LucideIcon; readonly children: string }) {
  return (
    <dt className={`flex items-center gap-1.5 ${META}`}>
      <Icon aria-hidden="true" className="size-3.5" />
      {children}
    </dt>
  );
}

/** The document facts after the role, in the frozen order, with a matching icon each. */
function documentFacts(cv: CandidateCv): readonly (readonly [string, LucideIcon, string])[] {
  return [
    ["Idioma", Languages, CV_LANGUAGE_LABELS[cv.language]],
    ["Actualizado", CalendarClock, formatDate(cv.updatedAt)],
    ["Tamaño", HardDrive, formatFileSize(cv.sizeBytes)],
    ["Formato", FileType2, "PDF"],
  ];
}

/**
 * The per-CV contextual menu. Base UI owns the closed state, keyboard/typeahead,
 * Escape, focus return and the `aria-haspopup`/`aria-expanded` trigger wiring, so
 * this component adds no menu behavior of its own. The trigger is a real 40px
 * ghost icon Button named for its CV, and the menu exposes only inert document
 * actions: the primary CV has no `Usar como principal` peer. No item uploads,
 * replaces, downloads, promotes, persists or touches the network.
 */
function CvActionsMenu({ cv }: { readonly cv: CandidateCv }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button type="button" variant="ghost" size="icon" className={TRIGGER} aria-label={`Acciones de ${cv.label}`} data-pf-cv-actions-trigger={cv.id} />}
      >
        <Ellipsis aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" side="bottom" className="min-w-44">
        <DropdownMenuGroup>
          <DropdownMenuItem data-pf-cv-replace={cv.id} className={MENU_ITEM}>
            <RefreshCw aria-hidden="true" />
            Reemplazar
          </DropdownMenuItem>
          <DropdownMenuItem data-pf-cv-download={cv.id} className={MENU_ITEM}>
            <Download aria-hidden="true" />
            Descargar
          </DropdownMenuItem>
          {cv.isPrimary ? null : (
            <DropdownMenuItem data-pf-cv-make-primary={cv.id} className={MENU_ITEM}>
              <Star aria-hidden="true" />
              Usar como principal
            </DropdownMenuItem>
          )}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * One CV as a semantic list item owning its own installed Card: identity header
 * with the file medallion, h3 label, wrapping filename and the single header
 * action menu; then the five facts in a responsive `dl`. The card carries no
 * footer: two peer actions belong in the contextual menu, not in a button tray.
 */
function CvCard({ cv }: { readonly cv: CandidateCv }) {
  return (
    <li className="min-w-0">
      <Card data-pf-cv-card={cv.id}>
        <CardHeader className="border-b">
          <div className="flex min-w-0 items-start gap-3">
            <span aria-hidden="true" className={MEDALLION}>
              <FileText className="size-5" />
            </span>
            <div className="min-w-0">
              <CardTitle>
                <h3 className="font-heading text-base font-semibold text-foreground">{cv.label}</h3>
              </CardTitle>
              <CardDescription data-pf-cv-filename={cv.id} className="mt-1 break-words">{cv.fileName}</CardDescription>
            </div>
          </div>
          <CardAction><CvActionsMenu cv={cv} /></CardAction>
        </CardHeader>
        <CardContent>
          <dl className={FACTS}>
            <div>
              <FactLabel icon={Star}>Rol</FactLabel>
              <dd className="mt-1"><RoleBadge isPrimary={cv.isPrimary} /></dd>
            </div>
            {documentFacts(cv).map(([term, Icon, value]) => (
              <div key={term}>
                <FactLabel icon={Icon}>{term}</FactLabel>
                <dd className="mt-1 text-foreground">{value}</dd>
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>
    </li>
  );
}

/** Static local CV inventory over the passed props. */
export function CvWorkspace({ cvs }: CvWorkspaceProps) {
  const { total, primary } = summarizeCvs(cvs);
  const ordered = orderCvs(cvs);
  return (
    <div data-pf-cv-workspace className="mx-auto w-full max-w-screen-2xl flex flex-col gap-5 px-4 py-4 lg:px-6">
      <header className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <h2 className="font-heading text-2xl font-semibold tracking-tight text-foreground">Tus CVs</h2>
          <p data-pf-cv-summary className="text-sm text-muted-foreground">{summaryText(total, primary)}</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" variant="outline" data-pf-cv-upload className={ACTION}>
            <Upload aria-hidden="true" data-icon="inline-start" />
            Subir CV
          </Button>
        </div>
      </header>
      {total === 0 ? (
        <Empty className="border border-dashed border-border bg-card">
          <EmptyHeader>
            <EmptyMedia variant="icon"><FileText aria-hidden="true" /></EmptyMedia>
            <EmptyTitle>Sin CVs</EmptyTitle>
            <EmptyDescription>Aquí se listan tus CVs con su rol, idioma, fecha, tamaño y formato.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ul data-pf-cv-list className={GRID}>
          {ordered.map((cv) => (<CvCard key={cv.id} cv={cv} />))}
        </ul>
      )}
    </div>
  );
}
