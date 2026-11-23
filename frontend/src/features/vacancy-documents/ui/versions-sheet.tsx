"use client";

import { useEffect, useRef, useState, type ComponentProps } from "react";
import { Download, Upload } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { listDocumentVersionsAction } from "../actions";
import { mapDocumentFailure } from "../failure";
import type { ItemWrite, OverviewItem, Scope, VersionHistory } from "../model";
import { FileField } from "./file-field";
import { checkFile, dateLabel, FORMAT_LABEL, sizeLabel } from "./format";
import { participationIdOf } from "./overview-state";
import { versionHref } from "./row-actions";
import { replaceDocumentFile } from "./upload-client";

type History = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; history: VersionHistory };

/**
 * Side sheet of one document (S5): its history with a download per version, and «Nueva versión» sending `expected_version` = the version the
 * person saw. `item` is the live row: after a conflict the overview is read again, `item.version` moves and the history is read again too.
 */
export function VersionsSheet({ draftId, item, limits, onClose, onReplaced, onReload, finalFocus }: {
  draftId: string; item: OverviewItem; limits: Scope["limits"]; onClose: () => void; onReplaced: (write: ItemWrite, participationId: string | null) => void; onReload: () => void;
  finalFocus?: ComponentProps<typeof SheetContent>["finalFocus"];
}) {
  const participationId = participationIdOf(item.owner);
  const [history, setHistory] = useState<History>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const input = useRef(0);
  useEffect(() => {
    let current = true;
    setHistory({ status: "loading" });
    listDocumentVersionsAction({ draftId, ...(participationId ? { participationId } : {}), documentId: item.id })
      .catch(() => mapDocumentFailure({ error: { kind: "network" } }))
      .then(result => { if (current) setHistory(result.ok ? { status: "ready", history: result.data } : { status: "error", message: result.message }); });
    return () => { current = false; };
  }, [draftId, participationId, item.id, item.version, attempt]);

  const canDownload = item.allowed_actions.includes("download");
  const canReplace = item.allowed_actions.includes("replace");
  const atMax = item.version_count >= limits.max_versions;
  async function send() {
    if (!file || fileError) return;
    setFailure(null); setSending(true);
    const result = await replaceDocumentFile({ draftId, participationId, file, documentId: item.id, expectedVersion: item.version });
    setSending(false);
    if (result.ok) { setFile(null); input.current += 1; onReplaced(result.data, participationId); return; }
    if (result.fields?.file) setFileError(result.fields.file); else setFailure(result.message);
    if (result.reload) onReload();
  }

  return <Sheet open onOpenChange={next => { if (!next && !sending) onClose(); }}>
    <SheetContent showCloseButton={false} finalFocus={finalFocus} className="w-full gap-0 sm:max-w-md">
      <SheetHeader className="border-b"><SheetTitle>{item.name}</SheetTitle>
        <SheetDescription>{`${FORMAT_LABEL[item.format]} · ${sizeLabel(item.size)} · v${item.version} · ${item.updated_by.name}`}</SheetDescription></SheetHeader>
      <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto p-6">
        <section aria-label="Versiones" className="flex flex-col gap-3"><h3 className="font-heading text-base font-semibold">Versiones</h3>
          {history.status === "loading" && <div role="status" aria-label="Cargando versiones" className="flex flex-col gap-2"><Skeleton className="h-12" /><Skeleton className="h-12" /></div>}
          {history.status === "error" && <div role="alert" className="flex flex-col items-start gap-2 text-sm"><p>{history.message}</p><Button type="button" variant="outline" className="min-h-10" onClick={() => setAttempt(value => value + 1)}>Reintentar</Button></div>}
          {history.status === "ready" && <ol className="flex flex-col gap-2">{history.history.versions.map(version => <li key={version.version} className="flex items-center gap-3 rounded-2xl border p-3">
            <div className="min-w-0 flex-1"><p className="flex items-center gap-2 font-medium">Versión {version.version}{version.is_current && <Badge variant="success">Vigente</Badge>}</p>
              <p className="text-xs text-muted-foreground">{`${FORMAT_LABEL[version.format]} · ${sizeLabel(version.size)} · ${dateLabel(version.uploaded_at)} · ${version.uploaded_by.name}`}</p></div>
            {canDownload && <Button variant="ghost" size="icon" className="size-10" nativeButton={false} role="link" render={<a href={versionHref(draftId, participationId, item.id, version.version)} download aria-label={`Descargar la versión ${version.version}`} />}><Download aria-hidden="true" /></Button>}
          </li>)}</ol>}
        </section>
        {canReplace && <section aria-label="Nueva versión" className="flex flex-col gap-3"><h3 className="font-heading text-base font-semibold">Reemplazar con una versión nueva</h3>
          {atMax ? <p className="text-sm text-muted-foreground">{`No disponible: llegó a ${limits.max_versions} de ${limits.max_versions} versiones.`}</p> : <>
            <FileField key={input.current} limits={limits} error={fileError} disabled={sending} onFile={next => { setFile(next); setFailure(null); setFileError(next ? checkFile(next, limits) : null); }} />
            <p className="text-xs text-muted-foreground">{`Reemplazas la versión ${item.version}. Si otra persona sube una nueva antes que tú, te avisaremos para que revises.`}</p>
            {failure && <p role="alert" className="text-sm text-status-danger">{failure}</p>}
            <Button type="button" className="min-h-10 self-start" disabled={!file || fileError !== null || sending} aria-busy={sending || undefined} onClick={send}><Upload aria-hidden="true" />{`Subir como versión ${item.version + 1}`}</Button></>}
        </section>}
      </div>
      <SheetFooter className="border-t"><SheetClose render={<Button type="button" variant="outline" className="min-h-10" />}>Cerrar</SheetClose></SheetFooter>
    </SheetContent>
  </Sheet>;
}
