"use client";
import type { CSSProperties, KeyboardEvent, ReactNode, Ref } from "react";
import Link from "next/link";
import { ChevronRight, Download, Ellipsis, FileText, Layers, Pencil, Send, ShieldCheck, Trash2, Upload } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { cvRowActions, type Cv, type CvLimits } from "@/features/candidate-cvs/model";
import { InfoPopover } from "@/features/psychometrics/help/info-popover";
import { CARD } from "../saved/queue";
import saved from "../saved/saved.module.css";
import { CvPreview } from "./cv-preview";
import { formatName, formatSize, formatWord, isPdf, LONG_DATE, maxMegabytes, SHORT_DATE } from "./format";

export const PREVIEW_ID = "cv-preview";
export const UPLOAD_DESCRIPTION_ID = "cv-upload-description";
export const LIMIT_REASON_ID = "cv-limit-reason";
export const FILE_ERROR_ID = "cv-file-error";
export type EditMode = "rename" | "delete";
/** Entrance class for a card: `rise` on a fast first load, `fade` when the library arrived late. */
export type Motion = string | undefined;
/** The file being uploaded or rejected, shown in the drop row (or the first-use card). */
export type UploadState = { file?: File; uploading: boolean; error?: string };
export const limitReason = (limits: CvLimits) => `Ya tienes ${limits.max_cvs} CVs. Elimina uno para subir otro.`;

/** The logo tile of a file: tinted by type (PDF danger, Word info), as the logo tile of a list row. */
export function FileTile({ cv, size = "row" }: { cv: Pick<Cv, "content_type">; size?: "row" | "detail" }) {
  return <span aria-hidden="true" className={cn("flex shrink-0 flex-col items-center justify-center gap-px rounded-xl text-[10px] leading-3 font-bold tracking-wide ring-1 ring-inset",
    size === "row" ? "size-10 sm:size-12" : "size-10",
    isPdf(cv) ? "bg-status-danger/9 text-status-danger ring-status-danger/22" : "bg-status-info/9 text-status-info ring-status-info/22")}>
    <FileText className={size === "row" ? "size-4 sm:size-5" : "size-4"} /><span>{isPdf(cv) ? "PDF" : "DOCX"}</span>
  </span>;
}

/** One library row: the whole row selects (wide) or expands in place (narrow); actions live in the panel or the expansion. */
export function CvRow({ cv, selected, narrow, onSelect, onKeyDown, children }: { cv: Cv; selected: boolean; narrow: boolean; onSelect: () => void; onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void; children?: ReactNode }) {
  const detailId = `cv-detail-${cv.id}`;
  const open = narrow && selected;
  return <li data-pf-cv-row={cv.id} className={cn("relative min-w-0 rounded-xl", open && "bg-primary/6")}>
    <button type="button" data-pf-cv-select onClick={onSelect} onKeyDown={onKeyDown}
      aria-current={!narrow && selected ? "true" : undefined} aria-expanded={narrow ? selected : undefined} aria-controls={narrow ? (open ? detailId : undefined) : PREVIEW_ID}
      className={cn("relative grid w-full min-w-0 grid-cols-[40px_minmax(0,1fr)_16px] items-center gap-3 rounded-xl px-2 py-2.5 text-left outline-none transition-colors duration-150 hover:bg-muted/70 focus-visible:ring-3 focus-visible:ring-ring/40 motion-reduce:transition-none sm:grid-cols-[48px_minmax(0,1fr)_16px] sm:gap-3.5 sm:px-3 sm:py-3",
        cv.in_use ? "min-h-19" : "min-h-16",
        !narrow && selected && "bg-primary/7 before:absolute before:inset-y-3.5 before:left-0 before:w-[3px] before:rounded-full before:bg-primary before:content-['']")}>
      <FileTile cv={cv} />
      <span className="flex min-w-0 flex-col gap-0.5">
        {/* T5: two lines with word breaks, so a long name still shows its extension at 390 px. */}
        <span data-pf-cv-name title={cv.name} className="line-clamp-2 text-[15px] leading-[22px] font-semibold break-words">{cv.name}</span>
        <span className="text-xs leading-4 text-muted-foreground tabular-nums">{formatWord(cv)} · {formatSize(cv.size)} · {SHORT_DATE.format(new Date(cv.uploaded_at))}</span>
        {cv.in_use && <span className="mt-1.5 flex"><Badge variant="success" dot>En uso</Badge></span>}
      </span>
      <ChevronRight aria-hidden="true" className={cn("size-4 transition-transform duration-150 motion-reduce:transition-none", selected ? "text-primary-text" : "text-muted-foreground", open && "rotate-90")} />
    </button>
    {open && <div id={detailId} className="px-2 pt-1 pb-3.5 sm:px-3">{children}</div>}
  </li>;
}

function Facts({ cv, limits }: { cv: Cv; limits: CvLimits }) {
  const facts: [string, ReactNode][] = [
    ["Formato", formatName(cv)],
    ["Tamaño", `${formatSize(cv.size)} de ${maxMegabytes(limits)} MB`],
    ["Subido", LONG_DATE.format(new Date(cv.uploaded_at))],
    ["Uso", cv.in_use ? <span className="-my-2.5 flex items-center"><Badge variant="success" dot>En uso</Badge><InfoPopover title="En uso" description="Enviaste este CV en al menos una postulación." footer="Cada postulación guarda su copia: si lo renombras o eliminas, lo que la empresa recibió no cambia." accessibleName="¿Qué significa en uso?" /></span> : "Sin enviar todavía"],
  ];
  return <dl className="flex flex-col gap-3.5">{facts.map(([term, value]) => <div key={term} className="min-w-0">
    <dt className="text-xs leading-4 text-muted-foreground">{term}</dt>
    <dd className="mt-0.5 font-medium tabular-nums">{value}</dd>
  </div>)}</dl>;
}

/** The retention note: what «En uso» means for renaming and deleting, or how an unsent CV is used. */
function UseNote({ cv }: { cv: Cv }) {
  const Icon = cv.in_use ? ShieldCheck : Send;
  return <p className="flex gap-2.5 rounded-xl bg-background p-3.5 text-[13px] leading-[18px] text-muted-foreground">
    <Icon aria-hidden="true" className="mt-px size-4 shrink-0 text-primary-text" />
    {cv.in_use ? <span><b className="font-semibold text-foreground">En uso.</b> Enviaste este CV en al menos una postulación. Cada postulación guarda su copia: si lo renombras o eliminas, lo que la empresa recibió no cambia.</span>
      : <span><b className="font-semibold text-foreground">Sin enviar todavía.</b> Al postularte eliges cuál de tus CVs enviar; este aparecerá en la lista.</span>}
  </p>;
}

function DownloadLink({ cv, className }: { cv: Cv; className?: string }) {
  const [download] = cvRowActions(cv);
  return <Button nativeButton={false} role="link" render={<a href={download.href} />} variant="outline" className={className} aria-label={`Descargar ${cv.name}`}><Download aria-hidden="true" data-icon="inline-start" />{download.label}</Button>;
}

/** Light preview panel of the selected CV (wide screens). The element persists across selections, so it never re-enters. */
export function CvPreviewPanel({ cv, index, total, limits, motion, onEdit }: { cv: Cv; index: number; total: number; limits: CvLimits; motion: Motion; onEdit: (mode: EditMode) => void }) {
  const [, rename, remove] = cvRowActions(cv);
  return <aside id={PREVIEW_ID} aria-labelledby="cv-preview-title" style={{ "--d": 2 } as CSSProperties} className={cn(CARD, "sticky top-6 gap-5 px-6 pt-5 pb-6", motion)}>
    <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3.5">
      <FileTile cv={cv} size="detail" />
      <div className="min-w-0">
        <h3 id="cv-preview-title" className="text-lg leading-[26px] font-semibold break-words">{cv.name}</h3>
        <p className="text-xs leading-4 text-muted-foreground tabular-nums">{formatWord(cv)} · {formatSize(cv.size)} · documento {index + 1} de {total}</p>
      </div>
      <div className="flex items-center gap-1">
        <DownloadLink cv={cv} className="min-h-10" />
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button type="button" variant="ghost" size="icon" className="size-10 text-muted-foreground" aria-label={`Acciones de ${cv.name}`} />}><Ellipsis aria-hidden="true" /></DropdownMenuTrigger>
          <DropdownMenuContent align="end" side="bottom" className="min-w-44">
            <DropdownMenuGroup><DropdownMenuItem className="min-h-10" onClick={() => onEdit(rename.key)}><Pencil aria-hidden="true" />{rename.label}</DropdownMenuItem></DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup><DropdownMenuItem className="min-h-10" variant="destructive" onClick={() => onEdit(remove.key)}><Trash2 aria-hidden="true" />{remove.label}</DropdownMenuItem></DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
    {/* The page sits beside the facts once the panel is wide enough (about 1440 px screens), above them before. */}
    <div className="@container/cv-panel">
      <div className="grid gap-6 @xl/cv-panel:grid-cols-[minmax(0,1fr)_240px]">
        <div data-pf-cv-stage className="grid place-items-center rounded-[18px] bg-muted p-7 @xl/cv-panel:min-h-110"><CvPreview cv={cv} className="max-w-80" /></div>
        <div className="flex flex-col gap-5">
          <Facts cv={cv} limits={limits} />
          <UseNote cv={cv} />
          <Button type="button" variant="ghost" className="-mt-2 -ml-3 min-h-10 self-start" onClick={() => onEdit(rename.key)}><Pencil aria-hidden="true" data-icon="inline-start" />{rename.label}</Button>
        </div>
      </div>
    </div>
  </aside>;
}

/** The same content as the panel, in an expanded row (narrow screens): 44 px buttons. */
export function CvInlineDetail({ cv, limits, onEdit }: { cv: Cv; limits: CvLimits; onEdit: (mode: EditMode) => void }) {
  const [, rename, remove] = cvRowActions(cv);
  return <div className="grid grid-cols-[104px_minmax(0,1fr)] items-start gap-3.5">
    <CvPreview cv={cv} size="compact" />
    <Facts cv={cv} limits={limits} />
    <DownloadLink cv={cv} className="col-span-2 min-h-11 w-full" />
    <div className="col-span-2 -mt-1.5 grid grid-cols-2 gap-2">
      <Button type="button" variant="ghost" className="min-h-11" onClick={() => onEdit(rename.key)}><Pencil aria-hidden="true" data-icon="inline-start" />{rename.label}</Button>
      <Button type="button" variant="ghost" className="min-h-11 text-destructive hover:bg-destructive/10 hover:text-destructive" onClick={() => onEdit(remove.key)}><Trash2 aria-hidden="true" data-icon="inline-start" />{remove.label}</Button>
    </div>
    <div className="col-span-2"><UseNote cv={cv} /></div>
  </div>;
}

/** The file being uploaded: tile, name and an honest spinner (the request reports no progress). */
function UploadProgress({ file }: { file: File }) {
  const docx = file.name.toLowerCase().endsWith(".docx");
  return <div role="status" aria-busy="true" className="grid grid-cols-[40px_minmax(0,1fr)] items-center gap-3 rounded-xl bg-background p-3 sm:grid-cols-[48px_minmax(0,1fr)] sm:gap-3.5">
    <FileTile cv={{ content_type: docx ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document" : "application/pdf" }} />
    <div className="min-w-0"><p className="truncate font-medium" title={file.name}>{file.name}</p>
      <p className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground tabular-nums"><Spinner aria-hidden="true" />Subiendo… {formatSize(file.size)}</p></div>
  </div>;
}

/** A rejected file: its name, then the reason as the field error the input points to. */
function FileError({ upload }: { upload: UploadState }) {
  if (!upload.file || !upload.error) return null;
  return <div className="flex min-w-0 basis-full flex-col gap-0.5">
    <p className="truncate text-xs font-medium" title={upload.file.name}>{upload.file.name}</p>
    <p id={FILE_ERROR_ID} role="alert" className="text-[13px] leading-[18px] text-destructive">{upload.error}</p>
  </div>;
}

/** Top of the library: «Sube otra versión», the upload in progress, or the full-library note. */
export function DropRow({ limits, atLimit, disabled, dragOver, upload, picker, describedBy, onPick }: { limits: CvLimits; atLimit: boolean; disabled: boolean; dragOver: boolean; upload: UploadState; picker: Ref<HTMLButtonElement>; describedBy: string; onPick: () => void }) {
  if (upload.uploading && upload.file) return <div className="mx-1 mb-2 sm:mx-1.5"><UploadProgress file={upload.file} /></div>;
  if (atLimit) return <div role="note" className="mx-1 mb-2 flex items-center gap-3 rounded-xl border-[1.5px] border-dashed border-border bg-background px-3.5 py-3 sm:mx-1.5">
    <span aria-hidden="true" className="grid size-9 shrink-0 place-items-center rounded-[11px] bg-card text-muted-foreground shadow-sm ring-1 ring-primary/15"><Layers className="size-4" /></span>
    <p className="min-w-0 flex-1 text-[13px] leading-[18px] text-muted-foreground"><b className="block text-sm font-semibold text-foreground">Biblioteca llena</b><span id={LIMIT_REASON_ID}>{limitReason(limits)}</span></p>
  </div>;
  return <div role="region" aria-label="Subir un CV" data-drag-over={dragOver}
    className={cn("mx-1 mb-2 flex flex-wrap items-center gap-3 rounded-xl border-[1.5px] border-dashed px-3.5 py-3 transition-colors duration-150 motion-reduce:transition-none sm:mx-1.5 sm:flex-nowrap", dragOver ? "border-primary bg-primary/10" : "border-primary/35 bg-primary/5", upload.error && "sm:flex-wrap")}>
    <span aria-hidden="true" className="grid size-9 shrink-0 place-items-center rounded-[11px] bg-card text-primary-text shadow-sm ring-1 ring-primary/15"><Upload className="size-4" /></span>
    <p className="min-w-0 flex-1 text-[13px] leading-[18px] text-muted-foreground"><b className="block text-sm font-semibold text-foreground">Sube otra versión</b><span id={UPLOAD_DESCRIPTION_ID}>Arrastra un PDF o Word aquí. Hasta {maxMegabytes(limits)} MB.</span></p>
    <Button ref={picker} type="button" variant="outline" className="min-h-11 w-full sm:min-h-10 sm:w-auto" disabled={disabled} aria-describedby={describedBy} onClick={onPick}>Elegir archivo</Button>
    <FileError upload={upload} />
  </div>;
}

/** «n de 10 · quedan N» under the rows. */
export function CapacityBar({ count, limits }: { count: number; limits: CvLimits }) {
  const left = limits.max_cvs - count;
  return <div className="flex items-center gap-2.5 px-3.5 pt-3 pb-2 text-xs text-muted-foreground tabular-nums">
    <Progress value={count / limits.max_cvs * 100} aria-labelledby="cv-capacity" className="flex-1 [&_[data-slot=progress-track]]:h-1.5" />
    <span id="cv-capacity">{count} de {limits.max_cvs} · {left > 0 ? `quedan ${left}` : "sin lugares libres"}</span>
  </div>;
}

/** First use: the tinted card of the candidate pages, with the upload as its primary action. */
export function EmptyCvs({ limits, disabled, upload, picker, describedBy, motion, onPick }: { limits: CvLimits; disabled: boolean; upload: UploadState; picker: Ref<HTMLButtonElement>; describedBy: string; motion: Motion; onPick: () => void }) {
  const rules = [[FileText, `${limits.content_types.map(type => type === "application/pdf" ? "PDF" : "Word (.docx)").join(" o ")}`], [Upload, `Hasta ${maxMegabytes(limits)} MB · o arrástralo aquí`], [ShieldCheck, "Lo que envíes no cambia"]] as const;
  return <section aria-labelledby="cv-empty-title" className={cn(CARD, saved.empty, "grid items-center gap-5 overflow-hidden px-5 py-6 sm:gap-8 sm:p-8 xl:grid-cols-[minmax(0,1fr)_minmax(0,420px)] xl:px-12 xl:py-10", motion)}>
    <div className="flex max-w-[520px] min-w-0 flex-col gap-3">
      <p className="flex items-center gap-2 text-xs leading-4 font-semibold tracking-wider text-primary-text uppercase before:size-1.5 before:rounded-full before:bg-primary before:content-['']">Tu biblioteca de CVs</p>
      <h3 id="cv-empty-title" className="text-xl leading-7 font-semibold tracking-tight text-balance sm:text-2xl sm:leading-8">Sube tu primer CV</h3>
      <p className="text-sm leading-[22px] text-muted-foreground sm:text-[15px] sm:leading-6">Revisa cada versión antes de enviarla: aquí ves su formato, su tamaño y si ya la usaste en una postulación. Hasta {limits.max_cvs} CVs.</p>
      {upload.uploading && upload.file ? <div className="mt-2 max-w-80"><UploadProgress file={upload.file} /></div>
        : <div className="mt-2 flex flex-wrap gap-2">
          <Button ref={picker} type="button" className="min-h-11 max-sm:flex-[1_1_100%]" disabled={disabled} aria-describedby={describedBy} onClick={onPick}><Upload aria-hidden="true" data-icon="inline-start" />Subir CV</Button>
          <Link href="/vacantes" className={cn(buttonVariants({ variant: "outline" }), "min-h-11 max-sm:flex-[1_1_100%]")}>Explorar vacantes</Link>
        </div>}
      <FileError upload={upload} />
      <p id={UPLOAD_DESCRIPTION_ID} className="mt-2 flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-muted-foreground">{rules.map(([Icon, text]) => <span key={text} className="inline-flex items-center gap-1.5"><Icon aria-hidden="true" className="size-3.5" />{text}</span>)}</p>
    </div>
    <div aria-hidden="true" className="-order-1 mx-auto grid w-full max-w-[400px] min-w-0 grid-cols-[minmax(0,1fr)_90px] items-center gap-3 rounded-[20px] bg-card p-4 shadow-sm ring-1 ring-primary/15 sm:grid-cols-[minmax(0,1fr)_120px] sm:p-4.5 xl:order-none">
      <ul className="flex flex-col gap-2">{[0, 1, 2].map(key => <li key={key} className={cn("flex items-center gap-2 rounded-[10px] p-2", key === 0 && "bg-primary/8")}>
        <span className={cn("size-7 shrink-0 rounded-lg", key === 1 ? "bg-status-info/10" : "bg-status-danger/10")} />
        <span className="flex flex-1 flex-col gap-1"><span className="h-1.5 rounded bg-border" /><span className="h-1.5 w-3/5 rounded bg-border" /></span>
      </li>)}</ul>
      <span className="grid aspect-[210/297] place-items-center rounded-md bg-card text-status-danger shadow-md ring-1 ring-foreground/5"><FileText className="size-6" /></span>
    </div>
  </section>;
}

/** Skeleton of the loaded layout: header summary, library card (drop row, two rows, capacity) and the preview panel. */
export function LoadingCvs({ narrow }: { narrow: boolean }) {
  return <div aria-busy="true" className="flex flex-col gap-6">
    <span role="status" className="sr-only">Cargando CVs</span>
    <div aria-hidden="true" className={cn("grid items-start gap-6", !narrow && "grid-cols-[minmax(0,420px)_minmax(0,1fr)]")}>
      <div className={cn(CARD, "gap-1 px-1.5 pt-4 pb-1.5 sm:px-3 sm:pt-5 sm:pb-2")}>
        <div className="grid gap-1.5 px-2.5 pb-2 sm:px-3"><Skeleton className="h-6 w-36" /><Skeleton className="h-3 w-28" /></div>
        <Skeleton className="mx-1 mb-2 h-16 rounded-xl sm:mx-1.5" />
        {[0, 1].map(key => <div key={key} data-pf-cv-loading-row className="grid min-h-19 grid-cols-[40px_minmax(0,1fr)] items-center gap-3 px-2 sm:grid-cols-[48px_minmax(0,1fr)] sm:gap-3.5 sm:px-3">
          <Skeleton className="size-10 rounded-xl sm:size-12" /><div className="grid gap-2"><Skeleton className="h-3.5 w-3/5" /><Skeleton className="h-3 w-2/5" /></div>
        </div>)}
        <Skeleton className="mx-3.5 mt-3 mb-2 h-1.5" />
      </div>
      {!narrow && <div data-pf-cv-loading-preview className={cn(CARD, "gap-5 px-6 pt-5 pb-6")}>
        <div className="flex items-center gap-3.5"><Skeleton className="size-10 rounded-xl" /><Skeleton className="h-4.5 w-1/2" /></div>
        <div className="grid min-h-110 place-items-center rounded-[18px] bg-muted p-7"><Skeleton className="aspect-[210/297] w-full max-w-80 rounded-md bg-card" /></div>
        <div className="grid grid-cols-2 gap-3">{[0, 1, 2, 3].map(key => <Skeleton key={key} className="h-9" />)}</div>
      </div>}
    </div>
  </div>;
}
