"use client";
import { useEffect, useRef, useState, type CSSProperties, type DragEvent, type KeyboardEvent } from "react";
import { CircleAlert, Upload } from "lucide-react";
import { cn } from "@/lib/utils";
import { DashboardPageContent } from "@/components/dashboard-page-content";
import { ActionBar, ActionStatus } from "@/components/feedback/action-status";
import { notifyActionResult } from "@/components/feedback/notify";
import { StateCard } from "@/components/feedback/state-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { loadCvsAction } from "@/features/candidate-cvs/actions";
import { CvDialog } from "@/features/candidate-cvs/cv-dialog";
import { RoleBlocked } from "@/features/identity/identity-states";
import { CvStorageUnavailable } from "@/features/candidate-cvs/storage-unavailable";
import { failureCopy, failureStatus, uncertain } from "@/features/candidate-cvs/feedback";
import { uploadValidation, type Cv, type CvFailure, type CvLibrary } from "@/features/candidate-cvs/model";
import { uploadCv } from "@/features/candidate-cvs/upload";
import { useNarrow } from "./saved/use-narrow";
import { acceptedFormats, maxMegabytes } from "./cvs/format";
import { CapacityBar, CvInlineDetail, CvPreviewPanel, CvRow, DropRow, EmptyCvs, FILE_ERROR_ID, LIMIT_REASON_ID, LoadingCvs, UPLOAD_DESCRIPTION_ID, type EditMode } from "./cvs/library";
import { CARD } from "./saved/queue";
import motion from "./cvs/cvs.module.css";

type Status = { tone: "success" | "error"; text: string; failure?: CvFailure };
type Entrance = "idle" | "rise" | "fade" | "off";
const STATUS_ID = "cv-library-status";
const noResponse = { ok: false, reason: "no_response", reference: {} } as const;
const hasFiles = (event: DragEvent) => Array.from(event.dataTransfer?.types ?? []).includes("Files");

/**
 * «Tus CVs» as artboard 03 (biblioteca con vista previa): the library card with a light preview panel on wide screens and
 * rows that expand in place below. Only the initial read replaces content with skeletons; mutations never retry themselves.
 */
export function CvWorkspace() {
  const [library, setLibrary] = useState<CvLibrary>();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadUncertain, setUploadUncertain] = useState(false);
  const [fileError, setFileError] = useState<string>();
  const [uploadFile, setUploadFile] = useState<File>();
  const [dragOver, setDragOver] = useState(false);
  const [status, setStatus] = useState<Status>();
  const [editing, setEditing] = useState<{ cv: Cv; mode: EditMode }>();
  // undefined: the first CV; null: nothing expanded (narrow only, after collapsing the open row).
  const [selectedId, setSelectedId] = useState<string | null>();
  const [focusTarget, setFocusTarget] = useState<string>();
  const [entrance, setEntrance] = useState<Entrance>("idle");
  const narrow = useNarrow();
  const root = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const picker = useRef<HTMLButtonElement>(null);
  const busy = useRef(false);
  useEffect(() => { if (fileError && !uploading) picker.current?.focus(); }, [fileError, uploading]);
  useEffect(() => {
    let active = true;
    const started = performance.now();
    void loadCvsAction().catch(() => noResponse).then(result => {
      if (!active) return;
      if (result.ok) { setLibrary(result.data); setEntrance(performance.now() - started > 600 ? "fade" : "rise"); }
      else setStatus({ tone: "error", text: failureStatus(result, failureCopy(result)), failure: result });
      setLoading(false);
    });
    return () => { active = false; };
  }, []);
  // One entrance, when the library first shows; `.enter` is dropped once it has played.
  useEffect(() => {
    if (entrance !== "rise" && entrance !== "fade") return;
    const timer = setTimeout(() => setEntrance("off"), 700);
    return () => clearTimeout(timer);
  }, [entrance]);
  // After a delete, focus the row that takes its place, else the page heading.
  useEffect(() => {
    if (!focusTarget) return;
    const target = focusTarget === "heading" ? null : root.current?.querySelector<HTMLElement>(`[data-pf-cv-row="${focusTarget}"] [data-pf-cv-select]`);
    (target ?? heading.current)?.focus();
    setFocusTarget(undefined);
  }, [focusTarget, library]);

  async function refresh(): Promise<boolean> {
    if (refreshing) return false;
    setRefreshing(true);
    try {
      const result = await loadCvsAction();
      if (!result.ok) {
        const copy = failureCopy(result);
        setStatus({ tone: "error", text: failureStatus(result, copy), failure: result });
        notifyActionResult({ key: "cv-load", type: "error", ...copy, reference: { ...result.reference, at: new Date().toISOString() } });
        return false;
      }
      setLibrary(result.data); setUploadUncertain(false);
      setEntrance(current => current === "idle" ? "fade" : current);
      setStatus({ tone: "success", text: "Biblioteca actualizada" });
      notifyActionResult({ key: "cv-load", type: "success", title: "Biblioteca actualizada", description: "Revisa tus CVs antes de volver a intentar un cambio." });
      return true;
    } catch {
      setStatus({ tone: "error", text: failureCopy(noResponse).title, failure: noResponse });
      notifyActionResult({ key: "cv-load", type: "error", ...failureCopy(noResponse), reference: { at: new Date().toISOString() } });
      return false;
    } finally { setRefreshing(false); }
  }
  async function selected(file?: File) {
    if (!file || !library || busy.current || uploadUncertain || library.items.length >= library.limits.max_cvs) return;
    setUploadFile(file);
    const validation = uploadValidation(file, library.limits);
    if (validation) { setFileError(validation); picker.current?.focus(); return; }
    setFileError(undefined); setStatus(undefined); setUploading(true); busy.current = true;
    try {
      const result = await uploadCv(file, library.limits);
      if (!result.ok) {
        const copy = failureCopy(result, library.limits.max_cvs, "upload");
        setStatus({ tone: "error", text: failureStatus(result, copy), failure: result }); setUploadUncertain(uncertain(result));
        if (["cv_too_large", "cv_unsupported_type", "cv_content_mismatch"].includes(result.reason)) { setFileError(copy.description); picker.current?.focus(); }
        notifyActionResult({ key: "cv-upload", type: "error", ...copy, reference: { ...result.reference, at: new Date().toISOString() } });
      } else {
        setLibrary(current => current ? { ...current, items: [result.data, ...current.items.filter(cv => cv.id !== result.data.id)] } : current);
        setSelectedId(result.data.id);
        setStatus({ tone: "success", text: "CV subido" });
        notifyActionResult({ key: "cv-upload", type: "success", title: "CV subido", description: "Ya puedes usarlo en tus postulaciones." });
      }
    } finally { busy.current = false; setUploading(false); if (input.current) input.current.value = ""; }
  }

  const items = library?.items ?? [];
  const chosen = selectedId ? items.find(cv => cv.id === selectedId) : undefined;
  const current = chosen ?? (selectedId === null && narrow ? undefined : items[0]);
  const atLimit = !!library && items.length >= library.limits.max_cvs;
  const uploadDisabled = atLimit || uploading || uploadUncertain;
  const pick = () => { if (!uploadDisabled) input.current?.click(); };
  function select(id: string) { setSelectedId(narrow && current?.id === id ? null : id); }
  function move(event: KeyboardEvent<HTMLButtonElement>, id: string) {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const ids = items.map(cv => cv.id);
    const next = ids[ids.indexOf(id) + (event.key === "ArrowDown" ? 1 : -1)];
    if (!next) return;
    root.current?.querySelector<HTMLElement>(`[data-pf-cv-row="${next}"] [data-pf-cv-select]`)?.focus();
    // Narrow rows expand on activation only; arrows just move between them.
    if (!narrow) setSelectedId(next);
  }
  function saved(target: Cv, updated: Cv | null) {
    if (!updated) {
      // The selection keeps its place: the next CV, or the previous one at the end.
      const index = items.findIndex(cv => cv.id === target.id);
      const next = items[index + 1] ?? items[index - 1];
      if (current?.id === target.id) setSelectedId(next?.id);
      setFocusTarget(next?.id ?? "heading");
    }
    setLibrary(prev => prev ? { ...prev, items: updated ? prev.items.map(cv => cv.id === updated.id ? updated : cv) : prev.items.filter(cv => cv.id !== target.id) } : prev);
    setStatus({ tone: "success", text: updated ? "Nombre actualizado" : "CV eliminado" });
  }
  // Dragging a file anywhere over the page offers the upload, as the drop row does.
  const drop = library ? {
    onDragOver: (event: DragEvent<HTMLDivElement>) => { if (!hasFiles(event)) return; event.preventDefault(); if (!uploadDisabled) setDragOver(true); },
    onDragLeave: (event: DragEvent<HTMLDivElement>) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragOver(false); },
    onDrop: (event: DragEvent<HTMLDivElement>) => { if (!hasFiles(event)) return; event.preventDefault(); setDragOver(false); if (!uploadDisabled) void selected(event.dataTransfer.files[0]); },
  } : {};

  if (status?.failure?.reason === "wrong_role") return <RoleBlocked kind="recruiter" />;
  const entering = entrance === "rise" || entrance === "fade";
  const cardMotion = entrance === "fade" ? motion.fade : motion.rise;
  const describedBy = [fileError ? FILE_ERROR_ID : UPLOAD_DESCRIPTION_ID, status ? STATUS_ID : undefined].filter(Boolean).join(" ");
  const upload = { file: uploadFile, uploading, error: fileError };
  const resultStatus = status ? <ActionStatus id={STATUS_ID} tone={status.tone} text={status.text} action={status.failure?.reason === "unauthenticated" ? <a className="inline-flex min-h-10 items-center underline" href="/candidato/login">Iniciar sesión</a> : undefined} /> : null;
  const recovery = uploadUncertain || (status?.tone === "error" && !uploading);
  const formats = library ? `${acceptedFormats(library.limits)}, hasta ${maxMegabytes(library.limits)} MB` : "";
  return <DashboardPageContent ref={root} data-pf-cv-workspace data-pf-cv-entrance={entrance} width="screen-2xl" className={cn("relative gap-6", entering && motion.enter)} {...drop}>
    <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
      <div className="grid min-w-0 gap-1">
        <h2 ref={heading} tabIndex={-1} className="text-2xl font-semibold tracking-tight outline-none sm:text-[28px] sm:leading-9">Tus CVs</h2>
        {loading ? <Skeleton aria-hidden="true" className="h-3.5 w-60 max-w-full" />
          : library && <p className="text-sm text-muted-foreground tabular-nums">{items.length > 0 && <><b className="font-semibold text-foreground">{items.length}</b> de {library.limits.max_cvs} CVs · <b className="font-semibold text-foreground">{items.filter(cv => cv.in_use).length}</b> en uso · </>}{formats}</p>}
      </div>
      {library && items.length > 0 && !narrow && <Button type="button" className="min-h-11" disabled={uploadDisabled} aria-busy={uploading} aria-describedby={atLimit ? LIMIT_REASON_ID : undefined} onClick={pick}>
        {uploading ? <Spinner aria-hidden="true" data-icon="inline-start" /> : <Upload aria-hidden="true" data-icon="inline-start" />}Subir CV
      </Button>}
    </header>
    {library && <>
      <label htmlFor="cv-file" className="sr-only">Archivo del CV</label>
      <input ref={input} type="file" id="cv-file" hidden accept={[...library.limits.content_types, ".pdf", ".docx"].join(",")} aria-invalid={!!fileError}
        aria-describedby={fileError ? FILE_ERROR_ID : atLimit ? LIMIT_REASON_ID : UPLOAD_DESCRIPTION_ID} disabled={uploadDisabled} onChange={event => void selected(event.target.files?.[0])} />
    </>}
    {library && resultStatus && <ActionBar status={resultStatus}>
      {recovery && <Button type="button" variant="outline" className="min-h-10" disabled={refreshing} onClick={() => void refresh()} aria-describedby={STATUS_ID}>{refreshing && <Spinner aria-hidden="true" />}{uploadUncertain ? "Comprobar" : status?.failure?.reason === "storage_unavailable" ? "Reintentar" : "Actualizar"}</Button>}
    </ActionBar>}
    {loading ? <LoadingCvs narrow={narrow} />
      : !library ? status?.failure?.reason === "storage_unavailable" ? <CvStorageUnavailable retry={() => void refresh()} pending={refreshing} status={resultStatus} statusId={STATUS_ID} />
        : <StateCard icon={CircleAlert} tone="error" title="No pudimos cargar tus CVs" description="Tus documentos no cambiaron. Vuelve a consultar para verlos."
          primaryAction={status?.failure?.reason === "unauthenticated" ? { label: "Iniciar sesión", href: "/candidato/login" } : { label: refreshing ? "Cargando…" : "Reintentar", disabled: refreshing, onClick: () => void refresh() }}
          secondaryAction={{ label: "Ir al panel", href: "/candidato" }} />
        : items.length === 0 ? <EmptyCvs limits={library.limits} disabled={uploadDisabled} upload={upload} picker={picker} describedBy={describedBy} motion={cardMotion} onPick={pick} />
          : <div className={cn("grid items-start gap-6", !narrow && "grid-cols-[minmax(0,420px)_minmax(0,1fr)]")}>
            <section aria-labelledby="cv-library-title" style={{ "--d": 1 } as CSSProperties} className={cn(CARD, "gap-1 px-1.5 pt-4 pb-1.5 sm:px-3 sm:pt-5 sm:pb-2", cardMotion)}>
              <div className="px-2.5 pb-2 sm:px-3">
                <h3 id="cv-library-title" className="flex items-center gap-2 text-lg leading-7 font-semibold">Biblioteca <Badge variant="neutral">{items.length}</Badge></h3>
                <p className="mt-0.5 text-xs text-muted-foreground">Más reciente primero</p>
              </div>
              <DropRow limits={library.limits} atLimit={atLimit} disabled={uploadDisabled} dragOver={dragOver} upload={upload} picker={picker} describedBy={describedBy} onPick={pick} />
              <ul aria-label="Tus CVs, el más reciente primero" className="flex flex-col gap-1">{items.map(cv => <CvRow key={cv.id} cv={cv} narrow={narrow} selected={current?.id === cv.id} onSelect={() => select(cv.id)} onKeyDown={event => move(event, cv.id)}>
                <CvInlineDetail cv={cv} limits={library.limits} onEdit={mode => setEditing({ cv, mode })} />
              </CvRow>)}</ul>
              <CapacityBar count={items.length} limits={library.limits} />
            </section>
            {!narrow && current && <CvPreviewPanel cv={current} index={items.indexOf(current)} total={items.length} limits={library.limits} motion={cardMotion} onEdit={mode => setEditing({ cv: current, mode })} />}
          </div>}
    {dragOver && <div aria-hidden="true" data-pf-cv-drop-overlay className="pointer-events-none absolute inset-3 z-30 grid place-items-center rounded-3xl border-2 border-dashed border-primary-text bg-background/90 p-6 text-center text-base font-semibold text-primary-text">
      <span className="rounded-2xl bg-primary/9 px-4 py-3">Suelta el archivo para subirlo · {formats}</span>
    </div>}
    {editing && <CvDialog key={`${editing.cv.id}-${editing.mode}`} {...editing} onClose={() => setEditing(undefined)} onCheck={refresh}
      onWrongRole={failure => setStatus({ tone: "error", text: failureCopy(failure).title, failure })} onSaved={updated => saved(editing.cv, updated)} />}
  </DashboardPageContent>;
}
