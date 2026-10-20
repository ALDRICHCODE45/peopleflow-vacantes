"use client";
import { useEffect, useRef, useState } from "react";
import { CalendarClock, CircleAlert, Download, Ellipsis, FileText, Pencil, Trash2, Upload } from "lucide-react";
import { DashboardPageContent } from "@/components/dashboard-page-content";
import { ActionBar, ActionStatus } from "@/components/feedback/action-status";
import { notifyActionResult } from "@/components/feedback/notify";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { StateCard } from "@/components/feedback/state-card";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
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

const DATE_FORMAT = new Intl.DateTimeFormat("es-MX", { dateStyle: "long", timeZone: "UTC" });
const DECIMAL_FORMAT = new Intl.NumberFormat("es-MX", { maximumFractionDigits: 1 });
const formatSize = (bytes: number) => bytes >= 1048576 ? `${DECIMAL_FORMAT.format(bytes / 1048576)} MB` : `${DECIMAL_FORMAT.format(Math.round(bytes / 1024))} KB`;
type Status = { tone: "success" | "error"; text: string; failure?: CvFailure };
function CvCard({ cv, onEdit }: { cv: Cv; onEdit: (mode: "rename" | "delete") => void }) {
  const [download, rename, remove] = cvRowActions(cv);
  return <li className="min-w-0"><Card data-pf-cv-card={cv.id}>
    <CardHeader className="border-b">
      <CardTitle className="flex min-w-0 items-start gap-3">
        <span aria-hidden="true" className="grid size-11 shrink-0 place-items-center rounded-full bg-primary/12 text-foreground ring-1 ring-primary/40"><FileText className="size-5" /></span>
        <h3 className="min-w-0 break-words font-heading text-base font-semibold">{cv.name}</h3>
      </CardTitle>
      <CardDescription className="pl-14">{cv.content_type === "application/pdf" ? "PDF" : "Word"} · {formatSize(cv.size)}</CardDescription>
      <CardAction><DropdownMenu>
        <DropdownMenuTrigger render={<Button type="button" variant="ghost" size="icon" className="size-10" aria-label={`Acciones de ${cv.name}`} data-pf-cv-actions-trigger={cv.id} />}><Ellipsis aria-hidden="true" /></DropdownMenuTrigger>
        <DropdownMenuContent align="end" side="bottom" className="min-w-44">
          <DropdownMenuGroup>
            <DropdownMenuItem render={<a href={download.href} />} className="min-h-10"><Download aria-hidden="true" />{download.label}</DropdownMenuItem>
            <DropdownMenuItem className="min-h-10" onClick={() => onEdit(rename.key)}><Pencil aria-hidden="true" />{rename.label}</DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup><DropdownMenuItem className="min-h-10" variant="destructive" onClick={() => onEdit(remove.key)}><Trash2 aria-hidden="true" />{remove.label}</DropdownMenuItem></DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu></CardAction>
    </CardHeader>
    <CardContent className="flex flex-col gap-4">
      {cv.in_use && <div><Badge variant="neutral">En uso</Badge></div>}
      <dl className="grid grid-cols-1 gap-4 text-sm">
        <div><dt className="flex items-center gap-1.5 text-[12.5px] text-muted-foreground"><CalendarClock aria-hidden="true" className="size-3.5" />Subido</dt><dd className="mt-1">{DATE_FORMAT.format(new Date(cv.uploaded_at))}</dd></div>
      </dl>
    </CardContent>
  </Card></li>;
}
function LoadingCvs() {
  return <section aria-busy="true" aria-label="Biblioteca de CVs" className="flex flex-col gap-5">
    <span role="status" className="sr-only">Cargando CVs</span>
    <div aria-hidden="true" data-pf-cv-loading-upload className="flex w-full flex-col gap-3 text-left [&_[data-pf-action-bar-actions]]:min-w-0 [&_[data-pf-action-bar-actions]]:shrink [&_[data-pf-action-bar-actions]]:max-sm:flex-1 [&_[data-pf-action-bar-actions]]:max-sm:flex-col">
      <Skeleton className="h-5 w-28" /><Skeleton><Progress value={null} className="invisible" /></Skeleton>
      <FieldGroup><Field><Skeleton className="w-32"><FieldLabel>&nbsp;</FieldLabel></Skeleton><Skeleton><Input type="file" disabled tabIndex={-1} className="invisible min-h-10" /></Skeleton><Skeleton className="w-56 max-w-full"><FieldDescription>&nbsp;</FieldDescription></Skeleton></Field></FieldGroup>
      <ActionBar status={null}><Skeleton className="w-full sm:w-auto"><Button type="button" disabled tabIndex={-1} className="invisible min-h-10 w-full sm:w-auto"><Upload aria-hidden="true" data-icon="inline-start" />Subir CV</Button></Skeleton></ActionBar>
    </div>
    {/* Skeletons mirror CvCard; the library size is not known until the initial read completes. */}
    <ul className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">{[0, 1].map(key => <li key={key} className="min-w-0">
      <Card aria-hidden="true">
        <CardHeader className="border-b">
          <CardTitle className="flex min-w-0 items-start gap-3"><Skeleton className="size-11 shrink-0 rounded-full" /><Skeleton className="h-6 w-44 max-w-full" /></CardTitle>
          <CardDescription className="pl-14"><Skeleton className="h-5 w-28" /></CardDescription>
          <CardAction><Skeleton><Button type="button" variant="ghost" size="icon" disabled tabIndex={-1} className="invisible size-10"><Ellipsis aria-hidden="true" /></Button></Skeleton></CardAction>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div><Skeleton className="h-6 w-16" /></div>
          <dl className="grid grid-cols-1 gap-4 text-sm"><div><dt><Skeleton className="h-[19px] w-20" /></dt><dd className="mt-1"><Skeleton className="h-5 w-36 max-w-full" /></dd></div></dl>
        </CardContent>
      </Card>
    </li>)}</ul>
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
  const [status, setStatus] = useState<Status>();
  const [editing, setEditing] = useState<{ cv: Cv; mode: "rename" | "delete" }>();
  const input = useRef<HTMLInputElement>(null);
  const busy = useRef(false);
  useEffect(() => { if (fileError && !uploading) input.current?.focus(); }, [fileError, uploading]);
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
    const validation = uploadValidation(file, library.limits);
    if (validation) { setFileError(validation); input.current?.focus(); return; }
    setFileError(undefined); setStatus(undefined); setUploading(true); busy.current = true;
    try {
      const result = await uploadCv(file, library.limits);
      if (!result.ok) {
        const copy = failureCopy(result, library.limits.max_cvs, "upload");
        setStatus({ tone: "error", text: failureStatus(result, copy), failure: result }); setUploadUncertain(uncertain(result));
        if (["cv_too_large", "cv_unsupported_type", "cv_content_mismatch"].includes(result.reason)) { setFileError(copy.description); input.current?.focus(); }
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
  const resultStatus = status ? <ActionStatus id="cv-library-status" tone={status.tone} text={status.text} action={status.failure?.reason === "unauthenticated" ? <a className="inline-flex min-h-10 items-center underline" href="/candidato/login">Iniciar sesión</a> : undefined} /> : null;
  // Reuse one uploader: the empty state brings the same action next to its explanation.
  const uploadForm = library ? <div className="flex w-full flex-col gap-3 text-left [&_[data-pf-action-bar-actions]]:min-w-0 [&_[data-pf-action-bar-actions]]:shrink [&_[data-pf-action-bar-actions]]:max-sm:flex-1 [&_[data-pf-action-bar-actions]]:max-sm:flex-col">
    <p id="cv-count" className="text-sm font-medium">{library.items.length} de {library.limits.max_cvs} CVs</p>
    <Progress value={library.items.length / library.limits.max_cvs * 100} aria-labelledby="cv-count" />
    <FieldGroup><Field data-invalid={!!fileError} data-disabled={!!atLimit || uploading || uploadUncertain}>
      <FieldLabel htmlFor="cv-file">Archivo del CV</FieldLabel>
      <Input ref={input} type="file" id="cv-file" accept={[...library.limits.content_types, ".pdf", ".docx"].join(",")} aria-invalid={!!fileError} aria-describedby={fileError ? "cv-file-error" : "cv-upload-description"} disabled={!!atLimit || uploading || uploadUncertain} className="min-h-10" onChange={event => void selected(event.target.files?.[0])} />
      <FieldDescription id="cv-upload-description">{limitReason ?? `PDF o Word (.docx), hasta ${library.limits.max_bytes / 1048576} MB.`}</FieldDescription>
      {fileError && <FieldError id="cv-file-error">{fileError}</FieldError>}
    </Field></FieldGroup>
    <ActionBar status={resultStatus}>
      {(uploadUncertain || (status?.tone === "error" && !uploading)) && <Button type="button" variant="outline" className="min-h-10 w-full sm:w-auto" disabled={refreshing} onClick={() => void refresh()} aria-describedby={status ? "cv-library-status" : undefined}>{refreshing && <Spinner aria-hidden="true" data-icon="inline-start" />}{uploadUncertain ? "Comprobar" : status?.failure?.reason === "storage_unavailable" ? "Reintentar" : "Actualizar"}</Button>}
      <Button type="button" className="min-h-10 w-full sm:w-auto" disabled={!!atLimit || uploading || uploadUncertain} aria-busy={uploading} aria-describedby={status ? "cv-library-status" : "cv-upload-description"} onClick={() => input.current?.click()}>{uploading ? <Spinner aria-hidden="true" data-icon="inline-start" /> : <Upload aria-hidden="true" data-icon="inline-start" />}{uploading ? "Subiendo…" : "Subir CV"}</Button>
    </ActionBar>
  </div> : null;
  return <DashboardPageContent data-pf-cv-workspace width="screen-2xl" className="gap-5">
    <header className="flex flex-col gap-1.5"><h2 className="font-heading text-2xl font-semibold tracking-tight">Tus CVs</h2><p className="max-w-prose text-sm text-muted-foreground">Guarda tus documentos y elige cuál usar en cada postulación.</p></header>
    {loading ? <LoadingCvs /> : <>
      {library ? <>
        {library.items.length ? <>{uploadForm}<ul data-pf-cv-list className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">{library.items.map(cv => <CvCard key={cv.id} cv={cv} onEdit={mode => setEditing({ cv, mode })} />)}</ul></> : <StateCard icon={FileText} tone="empty" title="Sin CVs" description="Sube tu primer CV: aparecerá en esta biblioteca y podrás elegirlo al postularte.">{uploadForm}</StateCard>}
      </> : status?.failure?.reason === "storage_unavailable" ? <CvStorageUnavailable retry={() => void refresh()} pending={refreshing} status={resultStatus} statusId="cv-library-status" /> : <StateCard icon={CircleAlert} tone="error" title="No pudimos cargar tus CVs" description="Tus documentos no cambiaron. Vuelve a consultar para verlos."
        primaryAction={status?.failure?.reason === "unauthenticated" ? { label: "Iniciar sesión", href: "/candidato/login" } : { label: refreshing ? "Cargando…" : "Reintentar", disabled: refreshing, onClick: () => void refresh() }}
        secondaryAction={{ label: "Ir al panel", href: "/candidato" }} />}
    </>}
    {editing && <CvDialog key={`${editing.cv.id}-${editing.mode}`} {...editing} onClose={() => setEditing(undefined)} onCheck={refresh} onWrongRole={failure => setStatus({ tone: "error", text: failureCopy(failure).title, failure })} onSaved={updated => {
      setLibrary(current => current ? { ...current, items: updated ? current.items.map(cv => cv.id === updated.id ? updated : cv) : current.items.filter(cv => cv.id !== editing.cv.id) } : current);
      setStatus({ tone: "success", text: updated ? "Nombre actualizado" : "CV eliminado" });
    }} />}
  </DashboardPageContent>;
}
