"use client";
import { useEffect, useId, useRef, useState, type RefObject } from "react";
import { ArrowDownToLine, FileText, Upload } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ActionBar, ActionStatus } from "@/components/feedback/action-status";
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
 candidate: OrgCandidateDetail; item: OrgCandidateParticipation; busy: boolean;
 onConfirmationChange: (confirmation: CvConfirmation | null) => void;
 onBusyChange: (busy: boolean) => void;
 onSaved: (detail: OrgCandidateDetail) => void;
 onConflict: () => Promise<void>;
};
const fileSize = (bytes: number) => bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${new Intl.NumberFormat("es-MX", { maximumFractionDigits: 1 }).format(bytes / 1024)} KB` : `${new Intl.NumberFormat("es-MX", { maximumFractionDigits: 1 }).format(bytes / 1024 / 1024)} MB`;
/** File metadata followed by one ActionBar (§12). Its action group can shrink to wrap in the sheet. */
export function ParticipationCv({ candidate, item, busy, onBusyChange, onSaved, onConflict, onConfirmationChange }: Props) {
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
 return <div className="flex min-w-0 flex-1 flex-col gap-3 [&_[data-pf-action-bar-actions]]:min-w-0 [&_[data-pf-action-bar-actions]]:shrink">
  {item.cv ? <p className="flex min-w-0 flex-wrap items-center gap-2 text-sm"><FileText aria-hidden="true" className="size-4 shrink-0" /><span className="min-w-0 break-all">{item.cv.file_name}</span>{item.cv.source === "company" && <Badge variant="accent">CV corregido por tu empresa</Badge>}</p> : <p className="text-sm text-muted-foreground">Sin CV</p>}
  {/* Native hidden file selection is exposed through the labeled upload button. No binary Server Action call. */}
  <Input ref={input} type="file" className="hidden" accept={CV_ACCEPT} aria-label={`CV corregido para ${item.vacancy.title}`} onChange={event => {
   const picked = event.target.files?.[0]; event.target.value = "";
   if (!picked || busy) return;
   const invalid = validateCvUpload(identity, item.id, candidate.etag, picked);
   if (invalid) { setFile(null); onConfirmationChange(null); failure(invalid); return; }
   setFile(picked); setStatus(null); confirmFile(picked);
  }} />
  <ActionBar status={status && <ActionStatus id={statusId} tone={status.tone} text={status.text} />}>
   {item.cv && <a className={cn(buttonVariants({ variant: "outline" }), "min-h-10")} href={candidateCvHref(identity, item.id)} download aria-label={`Descargar CV de ${item.vacancy.title}`}><ArrowDownToLine aria-hidden="true" data-icon="inline-start" />Descargar CV</a>}
   {item.cv?.source === "company" && item.original_cv && <a className={cn(buttonVariants({ variant: "outline" }), "min-h-10")} href={candidateCvHref(identity, item.id, "original")} download aria-label={`Descargar CV original de ${item.vacancy.title}`}><ArrowDownToLine aria-hidden="true" data-icon="inline-start" />Descargar CV original</a>}
   <Button ref={button} type="button" variant="outline" className="min-h-10" disabled={busy || pending} aria-busy={pending || undefined} aria-describedby={status ? statusId : undefined} onClick={() => {
    if (needsRefresh) { void refresh(); return; }
    if (file) confirmFile(file); else input.current?.click();
   }}><Upload aria-hidden="true" data-icon="inline-start" />{needsRefresh ? "Actualizar ficha" : "Subir CV corregido"}</Button>
  </ActionBar>
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
