"use client";
import { useEffect, useRef, useState } from "react";
import { CircleAlert, Download, Ellipsis, FileText, Pencil, Send, ShieldCheck, Tag, Trash2, Upload } from "lucide-react";
import { DashboardPageContent } from "@/components/dashboard-page-content";
import { ActionBar, ActionStatus } from "@/components/feedback/action-status";
import { notifyActionResult } from "@/components/feedback/notify";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { SectionEmpty, StateCard } from "@/components/feedback/state-card";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { loadCvsAction } from "@/features/candidate-cvs/actions";
import { CvDialog } from "@/features/candidate-cvs/cv-dialog";
import { RoleBlocked } from "@/features/identity/identity-states";
import { CvStorageUnavailable } from "@/features/candidate-cvs/storage-unavailable";
import { failureCopy, failureStatus, uncertain } from "@/features/candidate-cvs/feedback";
import { cvRowActions, uploadValidation, type Cv, type CvFailure, type CvLibrary } from "@/features/candidate-cvs/model";
import { uploadCv } from "@/features/candidate-cvs/upload";
import { HelpProvider, InfoPopover } from "@/features/psychometrics/help/info-popover";

const DATE_FORMAT = new Intl.DateTimeFormat("es-MX", { dateStyle: "long", timeZone: "UTC" });
const DECIMAL_FORMAT = new Intl.NumberFormat("es-MX", { maximumFractionDigits: 1 });
const formatSize = (bytes: number) => bytes >= 1048576 ? `${DECIMAL_FORMAT.format(bytes / 1048576)} MB` : `${DECIMAL_FORMAT.format(Math.round(bytes / 1024))} KB`;
const LAYOUT = "grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_340px]";
// Rows are a grid: the file tile is its own in-flow column so it sets the row height, as in the chosen artboard.
const ROW_HEADER = "min-w-0 grid-cols-[2.75rem_minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 has-data-[slot=card-action]:grid-cols-[2.75rem_minmax(0,1fr)_auto] 2xl:has-data-[slot=card-action]:grid-cols-[2.75rem_minmax(0,1fr)_auto_auto]";
const TILE = "col-start-1 row-span-2 row-start-1 flex h-13 w-11 flex-col items-center justify-center gap-0.5 rounded-md border";
type Status = { tone: "success" | "error"; text: string; failure?: CvFailure };
function CvCard({ cv, onEdit }: { cv: Cv; onEdit: (mode: "rename" | "delete") => void }) {
  const [download, rename, remove] = cvRowActions(cv);
  const type = cv.content_type === "application/pdf" ? "PDF" : "Word";
  return <li className="min-w-0"><Card size="sm" data-pf-cv-card={cv.id} className="py-3.5">
    <CardHeader className={ROW_HEADER}>
      <CardTitle className="contents">
        <span aria-hidden="true" className={cn(TILE, type === "PDF" ? "border-status-danger/25 bg-status-danger/10 text-status-danger" : "border-status-info/25 bg-status-info/10 text-status-info")}><FileText className="size-5" /><span className="text-[10px] font-semibold">{type}</span></span>
        <h3 className="col-start-2 row-start-1 min-w-0 self-end truncate text-sm font-medium" title={cv.name}>{cv.name}</h3>
      </CardTitle>
      <CardDescription className="col-start-2 row-start-2 self-start text-xs">{type} · {formatSize(cv.size)} · Subido el {DATE_FORMAT.format(new Date(cv.uploaded_at))}</CardDescription>
      {/* Contents exposes the badge and actions to the header grid: below metadata on small
          screens, beside the identity on wide screens, with no duplicate help controls. */}
      <CardAction className="contents">
        {cv.in_use && <div className="col-start-2 row-start-3 flex items-center 2xl:col-start-3 2xl:row-span-2 2xl:row-start-1"><Badge variant="success">Usado en postulaciones</Badge><InfoPopover title="Usado en postulaciones" description="Enviaste este CV en al menos una postulación." footer="Cada postulación guarda su copia: si lo renombras o eliminas, lo que la empresa recibió no cambia." accessibleName="¿Qué significa usado en postulaciones?" /></div>}
        <div className="col-start-3 row-span-2 row-start-1 flex items-center gap-1 2xl:col-start-4">
        <Button nativeButton={false} role="link" render={<a href={download.href} />} variant="ghost" className="min-h-10 max-sm:size-10" aria-label={`Descargar ${cv.name}`}><Download aria-hidden="true" /><span className="hidden sm:inline">Descargar</span></Button>
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button type="button" variant="ghost" size="icon" className="size-10" aria-label={`Acciones de ${cv.name}`} data-pf-cv-actions-trigger={cv.id} />}><Ellipsis aria-hidden="true" /></DropdownMenuTrigger>
          <DropdownMenuContent align="end" side="bottom" className="min-w-44">
            <DropdownMenuGroup><DropdownMenuItem className="min-h-10" onClick={() => onEdit(rename.key)}><Pencil aria-hidden="true" />{rename.label}</DropdownMenuItem></DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup><DropdownMenuItem className="min-h-10" variant="destructive" onClick={() => onEdit(remove.key)}><Trash2 aria-hidden="true" />{remove.label}</DropdownMenuItem></DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        </div>
      </CardAction>
    </CardHeader>
  </Card></li>;
}
function LoadingCvs() {
  return <section aria-busy="true" aria-label="Biblioteca de CVs" className={LAYOUT}>
    <span role="status" className="sr-only">Cargando CVs</span>
    <div aria-hidden="true" className="min-w-0"><Skeleton className="mb-3 h-4 w-40" /><ul className="grid gap-3">{[0, 1].map(key => <li key={key}>
      <Card size="sm" aria-hidden="true" className="py-3.5"><CardHeader className={ROW_HEADER}>
        <CardTitle className="contents"><Skeleton className="col-start-1 row-span-2 row-start-1 h-13 w-11" /><Skeleton className="col-start-2 row-start-1 h-5 w-44 max-w-full self-end" /></CardTitle>
        <CardDescription className="col-start-2 row-start-2 self-start"><Skeleton className="h-4 w-56 max-w-full" /></CardDescription>
        <CardAction className="contents"><Skeleton className="col-start-2 row-start-3 h-10 w-48 max-w-full 2xl:col-start-3 2xl:row-span-2 2xl:row-start-1" /><Skeleton className="col-start-3 row-span-2 row-start-1 h-10 w-20 2xl:col-start-4" /></CardAction>
      </CardHeader></Card>
    </li>)}</ul></div>
    <Card aria-hidden="true" data-pf-cv-loading-upload className="order-first xl:order-last"><CardHeader><CardTitle><Skeleton className="h-5 w-28" /></CardTitle></CardHeader><CardContent className="grid gap-5"><Skeleton className="h-52 w-full" /><Skeleton className="h-14 w-full" /><Skeleton className="h-44 w-full" /></CardContent></Card>
  </section>;
}
/** Real library; only the initial read replaces content with skeletons. Mutations never retry themselves. */
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
  const [editing, setEditing] = useState<{ cv: Cv; mode: "rename" | "delete" }>();
  const input = useRef<HTMLInputElement>(null);
  const picker = useRef<HTMLButtonElement>(null);
  const busy = useRef(false);
  useEffect(() => { if (fileError && !uploading) picker.current?.focus(); }, [fileError, uploading]);
  useEffect(() => {
    let active = true;
    void loadCvsAction().catch(() => ({ ok: false, reason: "no_response", reference: {} } as const)).then(result => {
      if (!active) return;
      if (result.ok) setLibrary(result.data);
      else setStatus({ tone: "error", text: failureStatus(result, failureCopy(result)), failure: result });
      setLoading(false);
    });
    return () => { active = false; };
  }, []);
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
      setStatus({ tone: "success", text: "Biblioteca actualizada" });
      notifyActionResult({ key: "cv-load", type: "success", title: "Biblioteca actualizada", description: "Revisa tus CVs antes de volver a intentar un cambio." });
      return true;
    } catch {
      const failure = { ok: false, reason: "no_response", reference: {} } as const;
      setStatus({ tone: "error", text: failureCopy(failure).title, failure });
      notifyActionResult({ key: "cv-load", type: "error", ...failureCopy(failure), reference: { at: new Date().toISOString() } });
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
        setStatus({ tone: "success", text: "CV subido" });
        notifyActionResult({ key: "cv-upload", type: "success", title: "CV subido", description: "Ya puedes usarlo en tus postulaciones." });
      }
    } finally { busy.current = false; setUploading(false); if (input.current) input.current.value = ""; }
  }
  if (status?.failure?.reason === "wrong_role") return <RoleBlocked kind="recruiter" />;
  const atLimit = library && library.items.length >= library.limits.max_cvs;
  const limitReason = atLimit ? `Ya tienes ${library.limits.max_cvs} CVs. Elimina uno para subir otro.` : undefined;
  const uploadDisabled = !!atLimit || uploading || uploadUncertain;
  const resultStatus = status ? <ActionStatus id="cv-library-status" tone={status.tone} text={status.text} action={status.failure?.reason === "unauthenticated" ? <a className="inline-flex min-h-10 items-center underline" href="/candidato/login">Iniciar sesión</a> : undefined} /> : null;
  const uploadPanel = library ? <aside aria-labelledby="cv-upload-title" className="order-first min-w-0 xl:order-last xl:sticky xl:top-6"><Card>
    <CardHeader><CardTitle><h3 id="cv-upload-title">Subir un CV</h3></CardTitle></CardHeader>
    <CardContent className="grid gap-3">
      <Field data-invalid={!!fileError}>
        <FieldLabel htmlFor="cv-file" className="sr-only">Archivo del CV</FieldLabel>
        <Input ref={input} type="file" id="cv-file" hidden accept={[...library.limits.content_types, ".pdf", ".docx"].join(",")} aria-invalid={!!fileError} aria-describedby={fileError ? "cv-file-error" : "cv-upload-description"} disabled={uploadDisabled} onChange={event => void selected(event.target.files?.[0])} />
        <div role="region" aria-label="Subir un CV" data-drag-over={dragOver} className={`grid justify-items-center gap-2 rounded-xl border border-dashed p-6 text-center ${dragOver && !uploadDisabled ? "border-primary bg-primary/10" : "border-border bg-background"}`}
          onDragOver={event => { event.preventDefault(); if (!uploadDisabled) setDragOver(true); }}
          onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragOver(false); }}
          onDrop={event => { event.preventDefault(); setDragOver(false); if (!uploadDisabled) void selected(event.dataTransfer.files[0]); }}>
          <span className="flex size-10 items-center justify-center rounded-full bg-primary/10" aria-hidden="true"><Upload className="size-5" /></span>
          <p className="font-medium">{atLimit ? "Biblioteca llena" : "Arrastra tu archivo aquí"}</p>
          <FieldDescription id="cv-upload-description">{limitReason ?? `${library.limits.content_types.map(type => type === "application/pdf" ? "PDF" : "Word (.docx)").join(" o ")}, hasta ${library.limits.max_bytes / 1048576} MB.`}</FieldDescription>
          <Button ref={picker} type="button" className="min-h-10 w-full sm:w-auto" disabled={uploadDisabled} aria-busy={uploading} aria-describedby={`cv-upload-description${fileError ? " cv-file-error" : ""}${status ? " cv-library-status" : ""}`} onClick={() => input.current?.click()}>{uploading && <Spinner aria-hidden="true" />}{uploading ? "Subiendo…" : "Elegir archivo"}</Button>
        </div>
        {uploadFile && (uploading || fileError || status?.tone === "error") && <div className="grid gap-1 rounded-lg bg-muted p-3">
          <p className="truncate text-sm font-medium" title={uploadFile.name}>{uploadFile.name}</p>
          {uploading && <p className="flex items-center gap-2 text-xs text-muted-foreground"><Spinner aria-hidden="true" />Subiendo… {formatSize(uploadFile.size)}</p>}
          {fileError && <FieldError id="cv-file-error">{fileError}</FieldError>}
          {!fileError && status?.tone === "error" && <p role="alert" className="text-xs text-destructive">{status.text}</p>}
        </div>}
      </Field>
      <ActionBar status={resultStatus}>
        {(uploadUncertain || (status?.tone === "error" && !uploading)) && <Button type="button" variant="outline" className="min-h-10" disabled={refreshing} onClick={() => void refresh()} aria-describedby={status ? "cv-library-status" : undefined}>{refreshing && <Spinner aria-hidden="true" />}{uploadUncertain ? "Comprobar" : status?.failure?.reason === "storage_unavailable" ? "Reintentar" : "Actualizar"}</Button>}
      </ActionBar>
    </CardContent>
    <CardContent className="grid gap-2 border-t pt-5">
      <div className="flex items-baseline justify-between gap-2 text-xs"><h4 id="cv-capacity-title">Espacio en tu biblioteca</h4><strong id="cv-count" className="tabular-nums">{library.items.length} de {library.limits.max_cvs}</strong></div>
      <Progress value={library.items.length / library.limits.max_cvs * 100} aria-labelledby="cv-capacity-title cv-count" className="[&_[data-slot=progress-track]]:h-1.5" />
      <p className="text-xs text-muted-foreground">{atLimit ? "Llegaste al límite. Elimina un CV que ya no uses para subir otro." : `Puedes subir ${library.limits.max_cvs - library.items.length} más.`}</p>
    </CardContent>
    <CardContent className="grid gap-3 border-t pt-5"><h4 className="text-sm font-semibold">Cómo aprovecharlos</h4><ul className="grid gap-3 text-xs text-muted-foreground">
      {[
        { icon: Tag, title: "Una versión por tipo de puesto", text: "Nómbralas para reconocerlas, por ejemplo «CV Frontend» o «CV en inglés»." },
        { icon: Send, title: "Eliges al postularte", text: "En cada postulación escoges cuál de estos CVs enviar." },
        { icon: ShieldCheck, title: "Lo enviado no cambia", text: "Cada postulación guarda su copia: renombrar o eliminar aquí no la afecta." },
      ].map(({ icon: Icon, title, text }) => <li key={title} className="flex items-start gap-2"><Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0" /><div><strong className="block font-medium text-foreground">{title}</strong>{text}</div></li>)}
    </ul></CardContent>
  </Card></aside> : null;
  return <DashboardPageContent data-pf-cv-workspace width="screen-2xl" className="gap-5">
    <header className="flex flex-col gap-1.5"><h2 className="font-heading text-2xl font-semibold tracking-tight">Tus CVs</h2><p className="max-w-prose text-sm text-muted-foreground">Guarda versiones de tu CV y elige cuál enviar en cada postulación.</p></header>
    {loading ? <LoadingCvs /> : <>
      {library ? <div data-pf-cv-layout className={LAYOUT}>
        <section aria-label="Biblioteca" className="min-w-0">
          <div className="mb-3 flex justify-between gap-2 text-xs text-muted-foreground"><h3>{library.items.length === 1 ? "1 documento" : `${library.items.length} documentos`}</h3><span>Más reciente primero</span></div>
          {library.items.length ? <HelpProvider><ul aria-label="Tus CVs" data-pf-cv-list className="grid gap-3">{library.items.map(cv => <CvCard key={cv.id} cv={cv} onEdit={mode => setEditing({ cv, mode })} />)}</ul></HelpProvider> : <Card><CardContent><SectionEmpty icon={FileText} tone="empty" title="Todavía no tienes CVs" description="Sube tu primer CV desde el panel. Aparecerá aquí y podrás elegirlo con un clic al postularte." /></CardContent></Card>}
        </section>
        {uploadPanel}
      </div> : status?.failure?.reason === "storage_unavailable" ? <CvStorageUnavailable retry={() => void refresh()} pending={refreshing} status={resultStatus} statusId="cv-library-status" /> : <StateCard icon={CircleAlert} tone="error" title="No pudimos cargar tus CVs" description="Tus documentos no cambiaron. Vuelve a consultar para verlos."
        primaryAction={status?.failure?.reason === "unauthenticated" ? { label: "Iniciar sesión", href: "/candidato/login" } : { label: refreshing ? "Cargando…" : "Reintentar", disabled: refreshing, onClick: () => void refresh() }}
        secondaryAction={{ label: "Ir al panel", href: "/candidato" }} />}
    </>}
    {editing && <CvDialog key={`${editing.cv.id}-${editing.mode}`} {...editing} onClose={() => setEditing(undefined)} onCheck={refresh} onWrongRole={failure => setStatus({ tone: "error", text: failureCopy(failure).title, failure })} onSaved={updated => {
      setLibrary(current => current ? { ...current, items: updated ? current.items.map(cv => cv.id === updated.id ? updated : cv) : current.items.filter(cv => cv.id !== editing.cv.id) } : current);
      setStatus({ tone: "success", text: updated ? "Nombre actualizado" : "CV eliminado" });
    }} />}
  </DashboardPageContent>;
}
