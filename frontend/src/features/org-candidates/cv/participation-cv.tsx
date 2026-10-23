"use client";
import { useEffect, useId, useRef, useState, type ReactNode, type RefObject } from "react";
import { ArrowDownToLine, ArrowUpRight, FileText, Upload } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Item, ItemContent, ItemDescription, ItemMedia } from "@/components/ui/item";
import { cn } from "cn";
import { DocumentItem } from "@/components/document/document-item";
import { filePresentation } from "@/features/pipeline-movement/pipeline-presentation";
import { Input } from "@/components/ui/input";
import { ActionStatus, ActionStatusSlot } from "@/components/feedback/action-status";
import { ConfirmActionDialog } from "@/components/feedback/confirm-action-dialog";
import { notifyActionResult } from "@/components/feedback/notify";
import { candidateCvHref, type OrgCandidateDetail, type OrgCandidateParticipation } from "../detail/detail-model";
import { CV_ACCEPT, cvFailureMessage, validateCvUpload, type CvFailure } from "./cv-model";
import { submitOrgCandidateCv } from "./upload";

export type CvConfirmation = {
 file: File; fullName: string; kind: OrgCandidateDetail["kind"];
 onConfirm: () => void; onChooseFile: () => void; finalFocus: RefObject<HTMLButtonElement | null>;
};
type Props = {
 candidate: OrgCandidateDetail; item: OrgCandidateParticipation; busy: boolean; children?: ReactNode;
 onConfirmationChange: (confirmation: CvConfirmation | null) => void;
 onBusyChange: (busy: boolean) => void;
 onSaved: (detail: OrgCandidateDetail) => void;
 onConflict: () => Promise<void>;
};
const fileSize = (bytes: number) => bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${new Intl.NumberFormat("es-MX", { maximumFractionDigits: 1 }).format(bytes / 1024)} KB` : `${new Intl.NumberFormat("es-MX", { maximumFractionDigits: 1 }).format(bytes / 1024 / 1024)} MB`;
/** The process document and upload stay in one mounted session so refreshes retain the selected file. */
export function ParticipationCv({ candidate, item, busy, onBusyChange, onSaved, onConflict, onConfirmationChange, children }: Props) {
 const input = useRef<HTMLInputElement>(null), button = useRef<HTMLButtonElement>(null);
 const alive = useRef(true), locked = useRef(false);
 const [file, setFile] = useState<File | null>(null);
 const [pending, setPending] = useState(false);
 const [needsRefresh, setNeedsRefresh] = useState(false);
 const [status, setStatus] = useState<{ tone: "success" | "error"; text: string } | null>(null);
 const statusId = useId();
 const identity = { kind: candidate.kind, id: candidate.id };
 const key = `candidate-cv:${candidate.kind}:${candidate.id}:${item.id}`;
 useEffect(() => { alive.current = true; return () => {
  alive.current = false;
  if (locked.current) onBusyChange(false);
 }; }, [onBusyChange]);
 function confirmFile(selected: File) {
  onConfirmationChange({ file: selected, fullName: candidate.full_name, kind: candidate.kind, onConfirm: () => { void upload(selected); }, onChooseFile: () => input.current?.click(), finalFocus: button });
 }
 function failure(result: CvFailure) {
  const text = cvFailureMessage(result);
  setStatus({ tone: "error", text });
  notifyActionResult({ key, type: "error", title: result.reason === "precondition_failed" ? "Esto cambió en otro lugar" : "No se guardó el CV", description: text, reference: { ...result.reference, at: new Date().toISOString() } });
 }
 async function refresh() {
  if (locked.current) return;
  locked.current = true; setPending(true); onBusyChange(true);
  try { await onConflict(); if (alive.current) setNeedsRefresh(false); }
  catch { if (alive.current) setStatus({ tone: "error", text: "No pudimos actualizar la ficha. Conservamos tu archivo; vuelve a actualizar." }); }
  finally { locked.current = false; if (alive.current) { setPending(false); onBusyChange(false); } }
 }
 async function upload(selected: File) {
  if (locked.current || busy || needsRefresh) return;
  locked.current = true; setPending(true); onBusyChange(true); setStatus(null);
  try {
   const result = await submitOrgCandidateCv(identity, item.id, candidate.etag, selected);
   if (!alive.current) return;
   onConfirmationChange(null);
   if (result.ok) {
    setFile(null); setStatus({ tone: "success", text: "CV corregido guardado" });
    onSaved(result.data);
    notifyActionResult({ key, type: "success", title: "CV corregido guardado", description: "Tu empresa verá el corregido; el CV de ingreso se conserva como original." });
   } else {
    failure(result);
    if (["precondition_failed", "precondition_required", "no_response", "server_error", "unrecognized_response"].includes(result.reason)) {
     setNeedsRefresh(true);
     try { await onConflict(); if (alive.current) setNeedsRefresh(false); }
     catch { if (alive.current) setStatus({ tone: "error", text: "No pudimos actualizar la ficha. Conservamos tu archivo; vuelve a actualizar." }); }
    }
   }
  } finally { locked.current = false; if (alive.current) { setPending(false); onBusyChange(false); } }
 }
 return <div className="flex min-w-0 flex-col gap-3">
  {children}
  {item.cv ? <DocumentItem presentation="panel" title={item.cv.file_name} fileType={filePresentation(item.cv.file_name) === "pdf" ? "PDF" : "DOCX"}
   description={filePresentation(item.cv.file_name) === "pdf" ? "Documento PDF" : "Documento Word"} badge={item.cv.source === "company" && <Badge variant="accent">CV corregido por tu empresa</Badge>}
   actions={<a className={cn(buttonVariants({ variant: "ghost", size: "icon" }), "min-h-10 min-w-10")} href={candidateCvHref(identity, item.id)} download aria-label={`Descargar archivo CV de ${item.vacancy.title}`}><ArrowDownToLine aria-hidden="true" /></a>}
   footer={<>
    <a className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "min-h-10")} href={candidateCvHref(identity, item.id)} download aria-label={`Descargar CV de ${item.vacancy.title}`}><ArrowDownToLine aria-hidden="true" data-icon="inline-start" />Descargar CV</a>
    {item.cv.source === "company" && item.original_cv && <a className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "min-h-10 text-muted-foreground")} href={candidateCvHref(identity, item.id, "original")} download aria-label={`Descargar CV original de ${item.vacancy.title}`}>Descargar CV original<ArrowUpRight aria-hidden="true" data-icon="inline-end" /></a>}
   </>} /> : <Item variant="muted" size="sm"><ItemMedia variant="icon"><FileText aria-hidden="true" /></ItemMedia><ItemContent><ItemDescription className="line-clamp-none">Sin CV en este proceso</ItemDescription></ItemContent></Item>}
  {/* Native hidden file selection is exposed through the labeled upload button. No binary Server Action call. */}
  <Input ref={input} type="file" className="hidden" accept={CV_ACCEPT} aria-label={`CV corregido para ${item.vacancy.title}`} onChange={event => {
   const picked = event.target.files?.[0]; event.target.value = "";
   if (!picked || busy) return;
   const invalid = validateCvUpload(identity, item.id, candidate.etag, picked);
   if (invalid) { setFile(null); onConfirmationChange(null); failure(invalid); return; }
   setFile(picked); setStatus(null); confirmFile(picked);
  }} />
  {/* Isolated action (§12): keep the result slot below it, not in a right-aligned footer bar. */}
   <Button ref={button} type="button" variant="outline" className="min-h-10 self-start" disabled={busy || pending} aria-busy={pending || undefined} aria-describedby={status ? statusId : undefined} onClick={() => {
    if (needsRefresh) { void refresh(); return; }
    if (file) confirmFile(file); else input.current?.click();
   }}><Upload aria-hidden="true" data-icon="inline-start" />{needsRefresh ? "Actualizar ficha" : "Subir CV corregido"}</Button>
  <ActionStatusSlot><div className="flex min-w-0 flex-col gap-1">
    <p className="text-xs text-muted-foreground">PDF o DOCX · Máximo 5 MB</p>
    {status && <ActionStatus id={statusId} tone={status.tone} text={status.text} />}
  </div></ActionStatusSlot>
 </div>;
}
/** A sibling of the Sheet root (§23), so Base UI keeps the confirmation's own backdrop. */
export function CvConfirmationDialog({ confirmation, pending, onClose }: { confirmation: CvConfirmation | null; pending: boolean; onClose: () => void }) {
 const finalFocus = useRef<HTMLButtonElement | null>(null);
 useEffect(() => { if (confirmation) finalFocus.current = confirmation.finalFocus.current; }, [confirmation]);
 return <ConfirmActionDialog open={confirmation !== null} onOpenChange={open => { if (!open) onClose(); }} onConfirm={() => confirmation?.onConfirm()} icon={Upload}
  title={`¿Subir CV corregido de ${confirmation?.fullName ?? "este candidato"}?`}
  description={confirmation?.kind === "organic" ? "El candidato conserva su CV original; tu empresa verá el corregido." : "Reemplaza el CV de este proceso; el CV de ingreso se conserva como original."}
  confirmLabel="Subir CV corregido" pendingLabel="Subiendo…" pending={pending} finalFocus={finalFocus}>
  {confirmation && <><dl className="flex min-w-0 items-start gap-3 text-sm"><dt className="flex shrink-0 items-center gap-2 text-muted-foreground"><FileText aria-hidden="true" className="size-4" />Archivo</dt><dd className="min-w-0 break-all">{confirmation.file.name}<span className="ml-2 whitespace-nowrap text-muted-foreground">{fileSize(confirmation.file.size)}</span></dd></dl><Button type="button" variant="ghost" disabled={pending} onClick={confirmation.onChooseFile}><Upload aria-hidden="true" data-icon="inline-start" />Elegir otro archivo</Button></>}
 </ConfirmActionDialog>;
}
