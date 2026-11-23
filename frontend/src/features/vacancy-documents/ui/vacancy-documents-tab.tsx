"use client";

import { useEffect, useRef, useState } from "react";
import { FileText, FilterX, Link2, SearchX, TriangleAlert, Upload } from "lucide-react";
import { notifyActionResult } from "@/components/feedback/notify";
import { SectionEmpty } from "@/components/feedback/state-card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { deleteDocumentAction, deleteDocumentLinkAction } from "../actions";
import type { DocumentOverview, ItemWrite, LinkWrite } from "../model";
import { DangerConfirmDialog } from "./confirm-dialog";
import { DocumentFilters } from "./documents-filters";
import { DocumentsTable } from "./documents-table";
import { plural } from "./format";
import { LinkSheet, linkDestinations } from "./link-sheet";
import { participationIdOf, withItem, withLink, withoutRow, withScope } from "./overview-state";
import type { RowIntent } from "./row-actions";
import { buildRows, chooseCandidate, chooseScope, filterRows, NO_FILTERS, scopeCounts, type DocRow, type Filters } from "./rows";
import { UploadDialog } from "./upload-dialog";
import { VersionsSheet } from "./versions-sheet";
import { useDocumentOverview } from "./use-document-overview";
import { useDownloadNotice } from "./use-download-notice";

type Removal = { kind: "delete" | "unlink"; row: DocRow };
const canUploadSomewhere = (overview: DocumentOverview) => overview.scope.allowed_actions.includes("upload") || overview.participations.some(entry => entry.scope_allowed_actions.includes("upload"));

function Loading() {
  return <div role="status" aria-label="Cargando documentos" className="flex flex-col gap-3">
    <Skeleton className="h-11 w-full max-w-xl" />
    {[0, 1, 2, 3, 4].map(index => <div key={index} aria-hidden="true" className="flex items-center gap-3 rounded-2xl border p-3"><Skeleton className="size-10 rounded-xl" /><div className="grid flex-1 gap-2"><Skeleton className="h-4 w-2/3" /><Skeleton className="h-3 w-1/3" /></div></div>)}
  </div>;
}

/**
 * The employer's Documentos tab (artboard 03): one table of the vacancy's and every candidate's documents and links, with the S13 filters.
 * `onOverview` hands the screen the tab's own read (the overview, or `null` when it failed) so the screen needs no second `document-overview` read.
 */
export function VacancyDocumentsTab({ draftId, onOverview }: { draftId: string; onOverview?: (overview: DocumentOverview | null) => void }) {
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const { state, reload, apply } = useDocumentOverview(draftId, filters.participationId);
  const report = useRef(onOverview);
  report.current = onOverview;
  const reported = state.status === "ready" ? state.overview : state.status === "error" ? null : undefined;
  useEffect(() => { if (reported !== undefined) report.current?.(reported); }, [reported]);
  const [removal, setRemoval] = useState<Removal | null>(null);
  const [removing, setRemoving] = useState<{ pending: boolean; error: string | null }>({ pending: false, error: null });
  const [upload, setUpload] = useState<{ initial: string | null } | null>(null);
  const [versionsOf, setVersionsOf] = useState<string | null>(null);
  const [linking, setLinking] = useState(false);
  useDownloadNotice();
  const focusTrigger = useRef<HTMLElement | null>(null);
  const uploadButton = useRef<HTMLButtonElement>(null);
  const linkButton = useRef<HTMLButtonElement>(null);
  const region = useRef<HTMLElement>(null);

  const intent = (what: RowIntent, row: DocRow, trigger: HTMLElement | null) => {
    focusTrigger.current = trigger;
    if (what === "replace") setVersionsOf(row.id);
    else { setRemoving({ pending: false, error: null }); setRemoval({ kind: what, row }); }
  };

  const openUpload = (initial: string | null, trigger: HTMLElement | null = uploadButton.current) => { focusTrigger.current = trigger; setUpload({ initial }); };
  /** The write's `scope` updates the flags and counts; the row joins the list unless the read is narrowed to another person. */
  function uploaded(write: ItemWrite, participationId: string | null) {
    setUpload(null);
    apply(overview => filters.participationId !== null && filters.participationId !== participationId
      ? withScope(overview, participationId, write.scope) : withItem(overview, write.item, participationId, write.scope));
    notifyActionResult({ key: "vacancy-documents", type: "success", title: "Documento subido" });
  }

  function replaced(write: ItemWrite, participationId: string | null) {
    apply(overview => withItem(overview, write.item, participationId, write.scope));
    notifyActionResult({ key: "vacancy-documents", type: "success", title: `Versión ${write.item.version} subida` });
  }

  /** Same rule as an upload: the link joins the table unless the read is narrowed to another person; its `scope` always updates the flags. */
  function linked(write: LinkWrite, participationId: string | null) {
    apply(overview => filters.participationId !== null && filters.participationId !== participationId
      ? withScope(overview, participationId, write.scope) : withLink(overview, write.link, participationId, write.scope));
  }

  async function confirmRemoval() {
    if (!removal) return;
    const { row } = removal;
    const participationId = participationIdOf(row.owner);
    const scope = { draftId, ...(participationId ? { participationId } : {}) };
    setRemoving({ pending: true, error: null });
    const result = row.kind === "item" ? await deleteDocumentAction({ ...scope, documentId: row.id }) : await deleteDocumentLinkAction({ ...scope, linkId: row.id });
    if (!result.ok) {
      setRemoving({ pending: false, error: result.message });
      if (result.reload) reload();
      return;
    }
    setRemoving({ pending: false, error: null });
    setRemoval(null);
    apply(overview => withoutRow(overview, row, participationId, result.data.scope));
    notifyActionResult({ key: "vacancy-documents", type: "success", title: row.kind === "item" ? "Documento eliminado" : "Vínculo quitado" });
  }

  if (state.status === "loading") return <section aria-labelledby="vacancy-documents-heading" className="flex flex-col gap-4"><h2 id="vacancy-documents-heading" className="font-heading text-xl font-semibold">Documentos</h2><Loading /></section>;
  if (state.status === "error") return <section aria-labelledby="vacancy-documents-heading" className="flex flex-col gap-4"><h2 id="vacancy-documents-heading" className="font-heading text-xl font-semibold">Documentos</h2>
    <div className="rounded-2xl border"><SectionEmpty icon={TriangleAlert} tone="empty" role="alert" title="No pudimos cargar los documentos" description={state.failure.message} primaryAction={{ label: "Reintentar", onClick: reload }} /></div></section>;

  const { overview, refreshing } = state;
  const allRows = buildRows(overview);
  const rows = filterRows(allRows, filters);
  const narrowed = filters.participationId !== null;
  const counts = scopeCounts(overview, allRows, narrowed);
  const chosen = overview.participations.find(entry => entry.participation_id === filters.participationId);
  const canUpload = canUploadSomewhere(overview);
  const uploadAction = canUpload && <Button ref={uploadButton} type="button" className="min-h-11" onClick={() => openUpload(filters.participationId)}><Upload aria-hidden="true" />Subir documento</Button>;
  const canLink = linkDestinations(overview, filters.participationId).length > 0;
  const linkAction = canLink && <Button ref={linkButton} type="button" variant="outline" className="min-h-11" onClick={() => setLinking(true)}><Link2 aria-hidden="true" />Vincular del proceso original</Button>;
  const versioned = overview.items.find(entry => entry.id === versionsOf);
  const searching = filters.search.trim() !== "";

  let body;
  if (rows.length > 0) {
    body = <DocumentsTable draftId={draftId} rows={rows} participations={overview.participations} limits={overview.scope.limits} busy={refreshing} onIntent={intent} onVersions={(row, trigger) => { focusTrigger.current = trigger; setVersionsOf(row.id); }} />;
  } else if (chosen && !searching) {
    const first = chosen.candidate.full_name.split(/\s+/)[0];
    body = <SectionEmpty icon={FileText} tone="empty" title={`${chosen.candidate.full_name} todavía no tiene documentos`}
      description={chosen.discarded ? `Quedó descartado en ${chosen.stage.name}, pero se le pueden subir documentos igual.` : `Está en ${chosen.stage.name} y todavía no se ha subido nada.`}
      primaryAction={chosen.scope_allowed_actions.includes("upload") ? { label: `Subir documento de ${first}`, onClick: () => openUpload(chosen.participation_id) } : undefined}
      secondaryAction={{ label: "Quitar filtro", onClick: () => setFilters(chooseCandidate(filters, null)) }} />;
  } else if (allRows.length === 0 && !narrowed && !searching && filters.scope === "all") {
    body = <SectionEmpty icon={FileText} tone="empty" title="Todavía no hay documentos en esta vacante"
      description="Guarda el contrato, el perfil del puesto o los documentos de cada persona candidata. Los ven tu equipo y los stakeholders; nunca el candidato."
      primaryAction={canUpload ? { label: "Subir el primer documento", onClick: () => openUpload(null) } : undefined} />;
  } else {
    body = <SectionEmpty icon={searching ? SearchX : FilterX} tone="empty" title="Sin resultados"
      description={searching ? `Ningún documento coincide con «${filters.search.trim()}».` : "No hay documentos en este filtro. Prueba con «Todos» para ver los de la vacante y los de las personas."}
      primaryAction={searching ? { label: "Limpiar búsqueda", onClick: () => setFilters({ ...filters, search: "" }) } : { label: "Mostrar todos", onClick: () => setFilters(chooseScope(filters, "all")) }} />;
  }

  return <section ref={region} tabIndex={-1} aria-labelledby="vacancy-documents-heading" className="flex min-h-0 flex-1 flex-col gap-4 outline-none">
    {/* The actions share the heading's row (at 1440 they did not fit beside scope, candidate and search and wrapped under them); on phones they go full width. */}
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
      <h2 id="vacancy-documents-heading" className="font-heading text-xl font-semibold">Documentos</h2>
      {(linkAction || uploadAction) && <div data-pf-documents-actions="" className="flex flex-wrap items-center gap-2 max-sm:w-full max-sm:flex-col max-sm:items-stretch">{linkAction}{uploadAction}</div>}
    </div>
    <DocumentFilters filters={filters} counts={counts} participations={overview.participations}
      onScope={scope => setFilters(chooseScope(filters, scope))} onCandidate={id => setFilters(chooseCandidate(filters, id))} onSearch={search => setFilters({ ...filters, search })} />
    {overview.truncated && <p role="note" className="rounded-2xl bg-muted px-4 py-3 text-sm">Se muestran los documentos más recientes de esta vacante. <strong className="font-medium">Filtra por candidato para ver el resto.</strong></p>}
    {rows.length > 0 ? body : <div className="rounded-2xl border">{body}</div>}
    {upload && <UploadDialog draftId={draftId} overview={overview} initialParticipationId={upload.initial} onClose={() => setUpload(null)} onUploaded={uploaded} onReload={reload}
      finalFocus={() => uploadButton.current?.isConnected ? uploadButton.current : region.current} />}
    {linking && <LinkSheet draftId={draftId} overview={overview} chosenParticipationId={filters.participationId} onClose={() => setLinking(false)} onLinked={linked} onReload={reload}
      onDone={count => notifyActionResult({ key: "vacancy-documents", type: "success", title: `${count === 1 ? "Se vinculó" : "Se vincularon"} ${plural(count, "documento", "documentos")}` })}
      finalFocus={() => linkButton.current?.isConnected ? linkButton.current : region.current} />}
    {versioned && <VersionsSheet draftId={draftId} item={versioned} limits={overview.scope.limits} onClose={() => setVersionsOf(null)} onReplaced={replaced} onReload={reload}
      finalFocus={() => focusTrigger.current?.isConnected ? focusTrigger.current : region.current} />}
    <DangerConfirmDialog open={removal !== null} onOpenChange={open => { if (!open) setRemoval(null); }} pending={removing.pending} error={removing.error} onConfirm={confirmRemoval}
      finalFocus={() => focusTrigger.current?.isConnected ? focusTrigger.current : region.current}
      title={removal?.kind === "unlink" ? "¿Quitar este vínculo?" : `¿Eliminar «${removal?.row.kind === "item" ? removal.row.item.name : ""}»?`}
      confirmLabel={removal?.kind === "unlink" ? "Desvincular" : "Eliminar documento"}
      description={removal?.kind === "unlink" ? "El documento original no se toca. Solo deja de verse en este proceso." : removal?.row.kind === "item" ? `Se elimina el documento y sus ${removal.row.item.version_count} versiones; no se puede deshacer. Queda registrado quién lo eliminó y cuándo. Si algún proceso de reemplazo lo tenía vinculado, ese vínculo pasará a «Documento eliminado».` : ""} />
  </section>;
}
