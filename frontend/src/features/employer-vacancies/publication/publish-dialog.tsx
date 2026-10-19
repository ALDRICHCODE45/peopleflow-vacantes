"use client";

import { Fragment, useCallback, useEffect, useRef, useState, type ComponentProps } from "react";
import Link from "next/link";
import { ArrowRight, CalendarDays, ClipboardList, FileText, Flag, GitBranch, Send, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Item, ItemActions, ItemContent, ItemGroup, ItemMedia, ItemSeparator, ItemTitle } from "@/components/ui/item";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { ActionBar, ActionStatus } from "@/components/feedback/action-status";
import { ConfirmActionDialog } from "@/components/feedback/confirm-action-dialog";
import { notifyActionResult } from "@/components/feedback/notify";
import { loadDraftForEditAction } from "@/features/jobs/drafts/reopen/load";
import { loadDraftPipelineAction } from "@/features/jobs/drafts/pipeline/actions";
import { loadDraftDeliveryAction } from "@/features/jobs/drafts/pipeline/delivery-actions";
import { loadDraftPublicationAction, publishDraftAction } from "@/features/jobs/drafts/pipeline/publication-actions";
import type { DraftPipelineActionFailure } from "@/features/jobs/drafts/pipeline/failure";
import type { DraftPublication } from "@/features/jobs/drafts/pipeline/publication-client";
import { formatPublicationDate, groupMissing, MISSING_GROUP_LABELS } from "@/features/jobs/drafts/pipeline/publication-model";

type Props = { draftId: string; open: boolean; onOpenChange: (open: boolean) => void; onPublished: (publishedAt: string) => void; unsavedChanges?: boolean };
type Snapshot = { etag: string; title: string; publication: DraftPublication; cutoff: string; target: number | null; commitmentDate: string | null };
type Mode = "loading" | "loaded" | "load_error" | "conflict" | "uncertain" | "rejected";
type Notice = { tone: "error" | "info" | "success"; text: string };
const GROUP_ICONS = { editor: FileText, solicitud: ClipboardList, entrega: Flag };

/** Same dialog for all entry points. Conditional session mount deliberately owns one key. */
export function PublishDialog(props: Props) {
  return <Dialog open={props.open} onOpenChange={props.onOpenChange}>
    {props.open && <PublicationSession key={props.draftId} {...props} />}
  </Dialog>;
}

export function PublishButton({ draftId, onPublished, unsavedChanges, variant = "outline", label = "Publicar" }: Pick<Props, "draftId" | "onPublished" | "unsavedChanges"> & { variant?: ComponentProps<typeof Button>["variant"]; label?: string }) {
  const [open, setOpen] = useState(false);
  return <Dialog open={open} onOpenChange={setOpen}>
    <DialogTrigger render={<Button type="button" variant={variant} className="min-h-10" />}><Send aria-hidden="true" data-icon="inline-start" />{label}</DialogTrigger>
    {open && <PublicationSession key={draftId} draftId={draftId} open onOpenChange={setOpen} onPublished={onPublished} unsavedChanges={unsavedChanges} />}
  </Dialog>;
}

function PublicationSession({ draftId, onOpenChange, onPublished, unsavedChanges = false }: Props) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [mode, setMode] = useState<Mode>("loading");
  const [notice, setNotice] = useState<Notice | null>(null);
  const [pending, setPending] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const key = useRef<string | null>(null);
  const busy = useRef(false);
  const alive = useRef(true);
  const heading = useRef<HTMLHeadingElement>(null);
  const initialMode = useRef(true);
  const completionAnchor = useRef<string | null>(null);
  // The recovery portal mounts after the mode effect; focus when its heading exists.
  // Keep the ref stable so pending/status renders do not steal focus from controls.
  const attachHeading = useCallback((node: HTMLHeadingElement | null) => {
    heading.current = node;
    if (node && !initialMode.current) node.focus();
  }, []);

  function report(tone: Notice["tone"], text: string, description: string, reference?: DraftPipelineActionFailure["reference"]) {
    setNotice({ tone, text });
    notifyActionResult({ key: "vacancy-publication", type: tone, title: text, description, ...(tone === "error" ? { reference: { ...reference, at: new Date().toISOString() } } : {}) });
  }
  function complete(publishedAt: string, already = false) {
    report(already ? "info" : "success", already ? "Esta vacante ya está publicada" : "Vacante publicada", "El tiempo de entrega ya está en marcha. La publicación en el sitio llega en el siguiente paso.");
    onOpenChange(false);
    onPublished(publishedAt);
  }
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);
  useEffect(() => {
    if (unsavedChanges) return;
    let current = true;
    async function load() {
      try {
        const [draft, publication, delivery, pipeline] = await Promise.all([
          loadDraftForEditAction(draftId), loadDraftPublicationAction(draftId), loadDraftDeliveryAction(draftId), loadDraftPipelineAction(draftId),
        ]);
        if (!current) return;
        if (!draft.ok || !publication.ok || !delivery.ok || !pipeline.ok) {
          setMode("load_error"); setNotice({ tone: "error", text: "No pudimos preparar la publicación" });
          if (attempt > 0) notifyActionResult({ key: "vacancy-publication", type: "error", title: "No pudimos preparar la publicación", description: "No se modificó la vacante. Es seguro volver a cargar los datos.", reference: { ...(!publication.ok ? publication.reference : !delivery.ok ? delivery.reference : !pipeline.ok ? pipeline.reference : {}), at: new Date().toISOString() } });
          return;
        }
        setSnapshot({ etag: draft.identity.etag, title: draft.seed.model.fields.title || "Sin título", publication: publication.publication,
          cutoff: pipeline.pipeline.stages.find(stage => stage.id === delivery.delivery.cutoffStageId)?.name ?? "Sin definir",
          target: delivery.delivery.targetQuantity, commitmentDate: delivery.delivery.commitmentDate });
        setMode("loaded");
        if (attempt > 0) {
          setNotice({ tone: "info", text: "Datos actualizados" });
          notifyActionResult({ key: "vacancy-publication", type: "info", title: "Datos actualizados", description: "Revisa el resumen antes de confirmar la publicación." });
        }
      } catch { if (current) {
        setMode("load_error"); setNotice({ tone: "error", text: "No pudimos preparar la publicación" });
        if (attempt > 0) notifyActionResult({ key: "vacancy-publication", type: "error", title: "No pudimos preparar la publicación", description: "No se modificó la vacante. Es seguro volver a cargar los datos.", reference: { at: new Date().toISOString() } });
      } }
    }
    void load();
    return () => { current = false; };
  }, [draftId, attempt, unsavedChanges]);
  useEffect(() => {
    if (initialMode.current) { initialMode.current = false; return; }
    heading.current?.focus();
  }, [mode, snapshot?.publication.missing.length]);

  function reload(newKey = false) {
    if (newKey) key.current = null;
    setMode("loading"); setNotice(null); setAttempt(value => value + 1);
  }
  async function reconcile(already = false) {
    if (busy.current) return;
    busy.current = true; setPending(true);
    try {
      const result = await loadDraftPublicationAction(draftId);
      if (!alive.current) return;
      if (result.ok && result.publication.status === "published" && result.publication.publishedAt) { complete(result.publication.publishedAt, already); return; }
      if (result.ok && !already) {
        setSnapshot(previous => previous ? { ...previous, publication: result.publication } : previous);
        setMode("loaded"); report("info", "Puedes volver a publicar", "No aparece publicada. Es seguro volver a intentar sin duplicar la publicación.");
      } else {
        setMode("uncertain"); report("error", "No pudimos confirmar el resultado", "No volvimos a publicar. Comprueba el estado antes de intentar otra vez.", result.ok ? {} : result.reference);
      }
    } catch {
      if (alive.current) { setMode("uncertain"); report("error", "No hubo respuesta del servidor", "No volvimos a publicar. Comprueba el estado antes de intentar otra vez."); }
    } finally { busy.current = false; if (alive.current) setPending(false); }
  }
  async function publish() {
    if (busy.current || !snapshot || unsavedChanges || mode !== "loaded" || snapshot.publication.missing.length || snapshot.publication.status !== "draft") return;
    busy.current = true; setPending(true); setNotice(null);
    key.current ??= crypto.randomUUID();
    try {
      const result = await publishDraftAction({ draftId, ifMatch: snapshot.etag, idempotencyKey: key.current, body: {} });
      if (!alive.current) return;
      if (result.ok) { complete(result.publication.publishedAt); return; }
      if (result.reason === "publication_incomplete") {
        setSnapshot({ ...snapshot, publication: { ...snapshot.publication, missing: result.missing } });
        report("error", "Faltan requisitos para publicar", "Tu contenido está a salvo. Completa los requisitos indicados y vuelve a revisar.", result.reference);
      } else if (result.reason === "already_published") {
        // Release only the local lock: this is an explicit read after a definitive conflict, never another POST.
        busy.current = false; await reconcile(true);
      } else if (result.reason === "version_conflict") {
        setMode("conflict"); report("error", "Esto cambió en otro lugar", "No publicamos esta versión. Revisa el contenido actualizado antes de confirmar.", result.reference);
      } else if (["no_response", "server_error", "unrecognized_response"].includes(result.reason)) {
        setMode("uncertain"); report("error", "No pudimos confirmar el resultado", "La publicación pudo completarse. Comprueba el estado; después será seguro reintentar sin duplicarla.", result.reference);
      } else {
        setMode("rejected"); report("error", result.reason === "unauthenticated" ? "Tu sesión expiró" : "No se pudo publicar", "Tu borrador está a salvo. Revisa tu sesión y los datos antes de volver a intentarlo.", result.reference);
      }
    } catch {
      if (alive.current) { setMode("uncertain"); report("error", "No hubo respuesta del servidor", "La publicación pudo completarse. Comprueba el estado antes de reintentar; no la duplicaremos."); }
    } finally { busy.current = false; if (alive.current) setPending(false); }
  }
  const missing = snapshot?.publication.missing ?? [];
  const already = snapshot?.publication.status === "published";
  const groups = missing.length ? groupMissing(missing) : [];
  const description = unsavedChanges ? "Vuelve al editor y guarda lo que cambiaste. No publicaremos una versión anterior."
    : missing.length ? `Faltan ${missing.length} ${missing.length === 1 ? "dato" : "datos"} en ${groups.length} ${groups.length === 1 ? "sección" : "secciones"}. Completa cada uno y vuelve a publicar.`
    : "Revisa los requisitos y confirma el inicio del tiempo de entrega.";
  const title = unsavedChanges ? "Guarda los cambios antes de publicar" : missing.length ? "Te falta para publicar" : already ? "Esta vacante ya está publicada" : "Publicar vacante";
  if (!unsavedChanges && mode === "loaded" && snapshot && !already && missing.length === 0) return <ConfirmActionDialog
    open onOpenChange={open => onOpenChange(open)} onConfirm={() => void publish()} icon={Send} title={`¿Publicar ${snapshot.title}?`}
    description="Empieza a contar el tiempo de entrega y la vacante queda activa. No se puede deshacer."
    // A failed publish replaces this confirmation with the checklist/recovery view.
    // Let its heading receive focus instead of restoring the removed loading view.
    finalFocus={() => heading.current ?? true}
    confirmLabel="Publicar vacante" pendingLabel="Publicando…" pending={pending}>
    <PublicationSummary snapshot={snapshot} />
    {notice && <ActionStatus id="publication-status" tone={notice.tone} text={notice.text} />}
  </ConfirmActionDialog>;
  return <DialogContent className="flex max-h-[min(44rem,calc(100dvh-2rem))] flex-col sm:max-w-lg" showCloseButton={!pending} initialFocus={heading} finalFocus={() => completionAnchor.current ? document.getElementById(completionAnchor.current) ?? false : true}>
    <DialogHeader><DialogTitle ref={attachHeading} tabIndex={-1} className="outline-none">{title}</DialogTitle><DialogDescription>{description}</DialogDescription></DialogHeader>
    {/* One native scroll region owns the overflow and its children never shrink (shrinking clipped
        the cards). Not ScrollArea: base-ui needs a fixed height and spilled out of this flexible dialog. */}
    <div data-pf-publication-scroll className="-mx-1 flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-1 pb-1 [scrollbar-width:thin]" aria-busy={!unsavedChanges && mode === "loading"}>
      {!unsavedChanges && mode === "loading" ? <><span role="status" className="sr-only">Cargando publicación</span><PublicationSkeleton missing={snapshot?.publication.missing ?? []} /></> : null}
      {!unsavedChanges && mode === "load_error" && <p className="text-sm text-muted-foreground">No se modificó la vacante. Puedes volver a cargar los datos.</p>}
      {!unsavedChanges && snapshot && mode !== "loading" && mode !== "load_error" && (missing.length ? groups.map(group => {
        const Icon = GROUP_ICONS[group.group];
        return <Card key={group.group} size="sm" role="region" aria-labelledby={`publication-${group.group}`} className="shrink-0">
          <CardHeader><CardTitle><h3 id={`publication-${group.group}`}>{MISSING_GROUP_LABELS[group.group]}</h3></CardTitle><CardAction><span className="text-sm tabular-nums text-muted-foreground">{group.items.length}</span></CardAction></CardHeader>
          <CardContent><ItemGroup className="gap-0">{group.items.map((item, index) => <Fragment key={`${item.code}-${index}`}>
            {index > 0 && <ItemSeparator className="my-0" />}
            <Item size="sm" role="listitem" className="px-0 py-1.5"><ItemMedia variant="icon"><Icon aria-hidden="true" /></ItemMedia><ItemContent><ItemTitle>{item.label}</ItemTitle></ItemContent><ItemActions><Button nativeButton={false} role="link" variant="ghost" className="min-h-10" render={<Link href={item.href(draftId)} onClick={event => {
              if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
              completionAnchor.current = event.currentTarget.hash.slice(1) || null;
              onOpenChange(false);
            }} />}>Completar<span className="sr-only"> {item.label}</span><ArrowRight aria-hidden="true" data-icon="inline-end" /></Button></ItemActions></Item>
          </Fragment>)}</ItemGroup></CardContent>
        </Card>;
      }) : already ? <p className="text-sm text-muted-foreground">{snapshot.publication.publishedAt ? `Publicada el ${formatPublicationDate(snapshot.publication.publishedAt)}` : "El tiempo de entrega ya está en marcha."}</p> : <>
        <PublicationSummary snapshot={snapshot} />
      </>)}
    </div>
    <DialogFooter className="flex-row"><ActionBar status={notice ? <ActionStatus id="publication-status" tone={notice.tone} text={notice.text} /> : null}>
      <Button type="button" variant="outline" className="min-h-10" disabled={pending} onClick={() => onOpenChange(false)}>Cancelar</Button>
      {!unsavedChanges && mode === "loading" && <Skeleton aria-hidden="true" className="h-10 w-40" />}
      {!unsavedChanges && mode === "load_error" && <Button type="button" className="min-h-10" onClick={() => reload()}>Reintentar</Button>}
      {!unsavedChanges && (mode === "conflict" || mode === "rejected") && <Button type="button" className="min-h-10" onClick={() => reload(mode === "conflict")}>Revisar de nuevo</Button>}
      {!unsavedChanges && mode === "uncertain" && <Button type="button" className="min-h-10" disabled={pending} onClick={() => void reconcile()} aria-describedby="publication-status">{pending && <Spinner aria-hidden="true" data-icon="inline-start" />}Comprobar</Button>}
    </ActionBar></DialogFooter>
  </DialogContent>;
}

function PublicationSummary({ snapshot }: { snapshot: Snapshot }) {
  return <div className="max-h-[50dvh] overflow-y-auto"><ItemGroup>{[
    { icon: FileText, label: "Vacante", value: snapshot.title },
    { icon: GitBranch, label: "Columna de corte", value: snapshot.cutoff },
    { icon: Users, label: "Objetivo de entrega", value: snapshot.target === null ? "Sin definir" : `${snapshot.target} candidatos` },
    { icon: CalendarDays, label: "Fecha compromiso", value: snapshot.commitmentDate ? formatPublicationDate(`${snapshot.commitmentDate}T12:00:00Z`) : "Sin definir" },
  ].map(row => <Item key={row.label} variant="outline" size="sm" role="listitem"><ItemMedia variant="icon"><row.icon aria-hidden="true" /></ItemMedia><ItemContent><span className="text-xs text-muted-foreground">{row.label}</span><ItemTitle>{row.value}</ItemTitle></ItemContent></Item>)}</ItemGroup></div>;
}

// Skeleton exception: use known checklist groups on reload; otherwise mirror the four summary Items.
function PublicationSkeleton({ missing }: { missing: readonly string[] }) {
  if (missing.length) return <div aria-hidden="true" className="flex flex-col gap-4">{groupMissing([...missing]).map(group => <Card key={group.group} size="sm" className="shrink-0"><CardHeader><CardTitle><Skeleton className="h-6 w-40" /></CardTitle><CardAction><Skeleton className="h-5 w-6" /></CardAction></CardHeader><CardContent><ItemGroup className="gap-0">{group.items.map((item, index) => <Fragment key={`${item.code}-${index}`}>{index > 0 && <ItemSeparator className="my-0" />}<Item size="sm" className="px-0 py-1.5"><ItemMedia variant="icon"><Skeleton className="size-4" /></ItemMedia><ItemContent><ItemTitle><Skeleton className="h-5 w-40" /></ItemTitle></ItemContent><ItemActions><Skeleton className="h-10 w-28" /></ItemActions></Item></Fragment>)}</ItemGroup></CardContent></Card>)}</div>;
  return <div aria-hidden="true" className="flex flex-col gap-5"><ItemGroup>{[0, 1, 2, 3].map(index => <Item key={index} variant="outline" size="sm"><ItemMedia variant="icon"><Skeleton className="size-4" /></ItemMedia><ItemContent><span><Skeleton className="h-4 w-28" /></span><ItemTitle><Skeleton className="h-5 w-40" /></ItemTitle></ItemContent></Item>)}</ItemGroup><Skeleton className="h-10 w-full" /></div>;
}
