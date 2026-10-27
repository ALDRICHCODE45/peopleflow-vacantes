"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight, Ellipsis, EyeOff, Upload } from "lucide-react";
import { ConfirmActionDialog } from "@/components/feedback/confirm-action-dialog";
import { ActionBar, ActionStatus } from "@/components/feedback/action-status";
import { notifyActionResult } from "@/components/feedback/notify";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Item, ItemActions, ItemContent, ItemGroup, ItemTitle } from "@/components/ui/item";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Spinner } from "@/components/ui/spinner";
import { loadSiteAction, publishSiteAction, unpublishSiteAction } from "../api/actions";
import type { SiteResult, SiteState } from "../api/model";
import type { AutosaveController } from "../autosave";
import { useAutosave } from "../use-autosave";
import { publishIssues, type PublishIssue, type SiteBlock } from "../model";
import { BLOCK_LIBRARY } from "../defaults";
import { validateSlug } from "../slug";
import { canPublish, RECRUITER_PUBLISH_REASON } from "../permissions";
import { COMPANY_SETTINGS_HREF } from "./site-settings";

export type PublicationTarget = { tab: "sections" | "settings"; blockId?: string; library?: boolean };
type Props = { controller: AutosaveController; role: string; company: { name: string; logo_url: string | null }; published: SiteState["published"]; onState: (state: SiteState) => void; onNavigate: (target: PublicationTarget) => void; onConflict: (current: SiteState) => void };
type ChecklistItem = { issue: PublishIssue; label: string; blockId?: string };
type Notice = { tone: "success" | "error" | "warning"; text: string };
const ISSUE_LABELS: Record<PublishIssue["code"], string> = {
  slug_missing: "Elige la dirección pública", hero_title_missing: "Agrega el título de la portada",
  no_content_block: "Agrega al menos una sección de contenido", block_incomplete: "Completa esta sección",
  company_logo_missing: "Agrega el logo de la empresa", company_name_missing: "Agrega el nombre de la empresa",
};
export function SitePublication({ controller, role, company, published, onState, onNavigate, onConflict }: Props) {
  const { flush } = useAutosave(controller);
  const [checklist, setChecklist] = useState<ChecklistItem[] | null>(null);
  const [confirmation, setConfirmation] = useState<{ version: number; slug: string } | null>(null);
  const [unpublish, setUnpublish] = useState(false);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [uncertain, setUncertain] = useState<{ kind: "publish"; version: number } | { kind: "unpublish" } | null>(null);
  const busy = useRef(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);
  const publishButton = useRef<HTMLButtonElement>(null);
  const checklistHeading = useRef<HTMLHeadingElement>(null);
  function report(tone: Notice["tone"], text: string, description: string, action?: { title: string; onClick: () => void }) {
    if (!alive.current) return;
    setNotice({ tone, text });
    notifyActionResult({ key: "company-site-publication", type: tone, title: text, description, action, ...(tone === "error" ? { reference: { at: new Date().toISOString() } } : {}) });
  }
  function announcePublished(slug: string) {
    report("success", "Sitio publicado", "Las personas que visiten tu dirección ya pueden ver esta versión.", { title: "Ver sitio", onClick: () => {
      if (validateSlug(slug) === null) window.open(`/empresas/${encodeURIComponent(slug)}`, "_blank", "noopener,noreferrer");
    } });
  }
  function showIssues(issues: PublishIssue[], blocks = controller.getSnapshot().editor.draft.blocks) {
    setConfirmation(null);
    setChecklist(issues.map(issue => {
      const match = /^blocks\[(\d+)\]/.exec(issue.field ?? "");
      const block = match ? blocks[Number(match[1])] : undefined;
      return { issue, label: issue.code === "block_incomplete" && block ? `Completa ${BLOCK_LIBRARY[block.type].label}` : ISSUE_LABELS[issue.code], blockId: block?.id };
    }));
  }
  async function savedVersion() {
    const result = await flush();
    if (!alive.current) return null;
    if (result.ok) return result.version;
    const snapshot = controller.getSnapshot();
    if (result.reason === "conflict" && snapshot.status.kind === "conflict") onConflict(snapshot.status.current);
    const text = result.reason === "unauthenticated" ? "Tu sesión expiró. Inicia sesión para publicar."
      : result.reason === "conflict" ? "Otra persona editó el sitio. Carga la versión más reciente."
      : result.reason === "invalid" ? "No publicamos. Revisa los campos marcados."
      : "No publicamos. Primero confirma el guardado del borrador.";
    report("error", text, "Tus cambios locales siguen aquí. Resuelve el guardado antes de publicar.");
    return null;
  }
  async function prepare() {
    if (busy.current || uncertain || !canPublish(role)) return;
    busy.current = true; setPending(true); setNotice(null);
    try {
      const version = await savedVersion(); if (!alive.current || version === null) return;
      const draft = controller.getSnapshot().editor.draft;
      const issues = publishIssues(draft, company);
      if (issues.length) showIssues(issues);
      else setConfirmation({ version, slug: draft.slug! });
    } finally { busy.current = false; if (alive.current) setPending(false); }
  }
  function failure(result: Exclude<SiteResult, { kind: "success" }>, operation: "publish" | "unpublish" = "publish", blocks?: SiteBlock[]) {
    if (!alive.current) return;
    if (result.kind === "error" && result.code === "forbidden") {
      report("error", operation === "publish" ? RECRUITER_PUBLISH_REASON : "Solo la persona dueña de la empresa puede despublicar. Tu borrador sigue disponible.", "Esta cuenta no tiene permiso para esta acción. No modificamos el sitio.");
      return;
    }
    if (result.kind === "uncertain" || result.kind === "unrecognized") setUncertain(operation === "publish" ? { kind: "publish", version: confirmation?.version ?? controller.getSnapshot().editor.draft_version } : { kind: "unpublish" });
    if (result.kind === "conflict") {
      setConfirmation(null); setUnpublish(false); onConflict(result.current);
      report("error", "Otra persona editó el sitio. Carga la versión más reciente.", "No publicamos esta versión. Tus cambios locales siguen aquí hasta que decidas recargar.");
    } else if (result.kind === "error" && result.code === "publish_blocked" && result.issues?.length) {
      showIssues(result.issues, blocks);
    } else {
      const text = result.kind === "unauthenticated" ? "Tu sesión expiró. Inicia sesión para publicar."
        : result.kind === "error" && result.code === "slug_taken" ? "La dirección está en uso. Elige otra en Configuración."
        : "No pudimos confirmar el resultado. Recarga antes de reintentar.";
      report("error", text, "Tu borrador está a salvo. La operación pudo completarse; revisa el estado antes de volver a intentarlo.");
    }
  }
  async function publish() {
    if (busy.current || uncertain || !canPublish(role) || !confirmation) return;
    busy.current = true; setPending(true);
    try {
      const version = await savedVersion();
      if (!alive.current) return;
      if (version === null) { setConfirmation(null); return; }
      const draft = controller.getSnapshot().editor.draft;
      const issues = publishIssues(draft, company);
      if (issues.length) { showIssues(issues); return; }
      if (version !== confirmation.version || controller.getSnapshot().editor.dirty) {
        setConfirmation({ version, slug: draft.slug! });
        setNotice({ tone: "warning", text: "El borrador cambió. Revisa la nueva versión antes de publicar." });
        return;
      }
      const result = await publishSiteAction(`"${version}"`);
      if (!alive.current) return;
      if (result.kind !== "success") { failure(result, "publish", draft.blocks); return; }
      onState(result.data); setConfirmation(null);
      announcePublished(result.data.published?.slug ?? confirmation.slug);
    } catch { failure({ kind: "uncertain" }); }
    finally { busy.current = false; if (alive.current) setPending(false); }
  }
  async function removePublication() {
    if (busy.current || uncertain || !canPublish(role)) return;
    busy.current = true; setPending(true);
    try {
      const result = await unpublishSiteAction();
      if (!alive.current) return;
      if (result.kind !== "success") { failure(result, "unpublish"); return; }
      onState(result.data); setUnpublish(false);
      report("success", "Sitio despublicado", "Tu dirección ya no muestra el sitio. El borrador sigue disponible para tu equipo.");
    } catch { failure({ kind: "uncertain" }, "unpublish"); }
    finally { busy.current = false; if (alive.current) setPending(false); }
  }
  async function checkState() {
    if (busy.current || !uncertain) return;
    busy.current = true; setPending(true);
    try {
      const result = await loadSiteAction();
      if (!alive.current) return;
      if (result.kind !== "success") {
        report("error", "No pudimos comprobar el estado", "No repetimos la operación. Puedes volver a comprobar sin modificar el sitio.");
        return;
      }
      onState(result.data); setUncertain(null);
      if (uncertain.kind === "publish" && result.data.published?.version === uncertain.version) {
        setConfirmation(null);
        announcePublished(result.data.published.slug);
      } else if (uncertain.kind === "unpublish" && result.data.published === null) {
        setUnpublish(false);
        report("success", "Sitio despublicado", "Confirmamos que tu dirección ya no muestra el sitio.");
      } else report("warning", "Estado actualizado. Revisa antes de reintentar.", "No repetimos la operación. Revisa el estado y confirma de nuevo si quieres continuar.");
      if (result.data.draft_version !== controller.getSnapshot().editor.draft_version) {
        setConfirmation(null); setUnpublish(false); onConflict(result.data);
      }
    } catch { report("error", "No pudimos comprobar el estado", "No repetimos la operación. Puedes volver a comprobar sin modificar el sitio."); }
    finally { busy.current = false; if (alive.current) setPending(false); }
  }
  const recoveryAction = uncertain ? <Button variant="outline" className="min-h-10" disabled={pending} onClick={() => void checkState()}>Comprobar estado</Button> : undefined;
  const owner = canPublish(role);
  return <div className="flex min-w-0 flex-col gap-1">
    <ActionBar status={notice ? <ActionStatus id="publication-status" tone={notice.tone} text={notice.text} action={recoveryAction} /> : null}>
      {owner ? <Button ref={publishButton} className="min-h-10" onClick={() => void prepare()} disabled={pending || Boolean(uncertain)} aria-busy={pending} aria-describedby="publication-status">{pending ? <Spinner aria-hidden="true" data-icon="inline-start" /> : <Upload aria-hidden="true" data-icon="inline-start" />}{pending ? "Preparando…" : "Publicar"}</Button> : <Tooltip><TooltipTrigger render={<span tabIndex={0} aria-label="Solo la persona dueña de la empresa puede publicar" className="inline-flex rounded-2xl outline-none focus-visible:ring-3 focus-visible:ring-ring/30" />}><Button disabled className="min-h-10"><Upload aria-hidden="true" data-icon="inline-start" />Publicar</Button></TooltipTrigger><TooltipContent>Solo la persona dueña de la empresa puede publicar</TooltipContent></Tooltip>}
      {owner && <DropdownMenu><DropdownMenuTrigger render={<Button variant="ghost" size="icon" className="size-10" aria-label="Acciones de publicación" disabled={pending || Boolean(uncertain)} />}><Ellipsis aria-hidden="true" /></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuGroup><DropdownMenuItem className="min-h-10" disabled={!published} onClick={() => { setNotice(null); setUnpublish(true); }}><EyeOff aria-hidden="true" />Despublicar</DropdownMenuItem></DropdownMenuGroup></DropdownMenuContent></DropdownMenu>}
    </ActionBar>
    <Dialog open={checklist !== null} onOpenChange={open => { if (!open) setChecklist(null); }}><DialogContent initialFocus={checklistHeading} finalFocus={publishButton} className="max-h-[calc(100dvh-2rem)] grid-rows-[auto_minmax(0,1fr)_auto]"><DialogHeader className="pr-8"><DialogTitle ref={checklistHeading} tabIndex={-1}>Antes de publicar</DialogTitle><DialogDescription>Completa estos requisitos. Tu borrador está guardado y aún no es público.</DialogDescription></DialogHeader>
      <ItemGroup className="min-h-0 overflow-y-auto">{checklist?.map(({ issue, label, blockId }, index) => <Item key={`${issue.code}-${index}`} size="sm"><ItemContent><ItemTitle>{label}</ItemTitle></ItemContent><ItemActions>{issue.code === "company_logo_missing" || issue.code === "company_name_missing" ? <Button nativeButton={false} role="link" variant="outline" className="min-h-10" render={<Link href={COMPANY_SETTINGS_HREF} />}>Configuración de la empresa</Button> : <Button variant="ghost" className="min-h-10" aria-label={`Ir a la sección: ${label}`} onClick={() => { setChecklist(null); onNavigate(issue.code === "slug_missing" ? { tab: "settings" } : { tab: "sections", ...(blockId ? { blockId } : { library: true }) }); }}>Ir a la sección<ArrowRight aria-hidden="true" data-icon="inline-end" /></Button>}</ItemActions></Item>)}</ItemGroup>
      <DialogFooter><ActionBar status={null}><DialogClose render={<Button variant="outline" className="min-h-10" />}>Volver al editor</DialogClose></ActionBar></DialogFooter>
    </DialogContent></Dialog>
    <ConfirmActionDialog open={confirmation !== null} onOpenChange={open => { if (!open) setConfirmation(null); }} finalFocus={() => checklist ? false : publishButton.current ?? true} icon={Upload} title="¿Publicar tu sitio?" description={`Quienes visiten /empresas/${confirmation?.slug ?? ""} verán esta versión del sitio y las vacantes publicadas de tu empresa. La versión pública anterior será reemplazada.`} confirmLabel="Publicar sitio" pendingLabel="Publicando…" pending={pending} confirmDisabled={Boolean(uncertain)} onConfirm={() => void publish()}>
      {confirmation && notice && <ActionStatus id="publication-confirm-status" tone={notice.tone} text={notice.text} action={recoveryAction} />}
    </ConfirmActionDialog>
    <ConfirmActionDialog open={unpublish} onOpenChange={setUnpublish} icon={EyeOff} title="¿Despublicar tu sitio?" description="Las personas que visiten tu dirección ya no podrán ver el sitio. Tu equipo conservará el borrador y podrá volver a publicarlo." confirmLabel="Despublicar sitio" pendingLabel="Despublicando…" pending={pending} confirmDisabled={Boolean(uncertain)} onConfirm={() => void removePublication()}>
      {unpublish && notice && <ActionStatus id="unpublish-confirm-status" tone={notice.tone} text={notice.text} action={recoveryAction} />}
    </ConfirmActionDialog>
  </div>;
}
