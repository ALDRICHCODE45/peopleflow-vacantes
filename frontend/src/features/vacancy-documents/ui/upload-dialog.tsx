"use client";

import { useRef, useState, type ComponentProps } from "react";
import { Briefcase, Upload, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Progress, ProgressLabel, ProgressValue } from "@/components/ui/progress";
import { ChoiceList, type ChoiceOption } from "@/components/ui/choice-list";
import type { DocumentOverview, ItemWrite } from "../model";
import { CandidatePicker } from "./candidate-picker";
import { DocumentFileField } from "./file-field";
import { checkFile, plural } from "./format";
import { uploadDocumentFile } from "./upload-client";

type Dest = "vacancy" | "candidate";
const blocked = (reason: string | null, subject: string, max: number) =>
  reason === "limit_reached" ? `${subject} llegó al límite de ${plural(max, "documento", "documentos")} (archivos y vínculos). Elimina uno para subir otro.` : null;

/** «Subir documento» (S1, S3, S4): destination first, then the file, pre-checked against `limits` and sent with one Idempotency-Key per intent. */
export function UploadDialog({ draftId, overview, initialParticipationId, onClose, onUploaded, onReload, finalFocus }: {
  draftId: string; overview: DocumentOverview; initialParticipationId: string | null; onClose: () => void;
  onUploaded: (write: ItemWrite, participationId: string | null) => void; onReload: () => void; finalFocus?: ComponentProps<typeof DialogContent>["finalFocus"];
}) {
  const { scope, participations } = overview;
  const vacancyOk = scope.allowed_actions.includes("upload");
  const startsWith = initialParticipationId && participations.find(entry => entry.participation_id === initialParticipationId)?.scope_allowed_actions.includes("upload") ? initialParticipationId : null;
  const [dest, setDest] = useState<Dest>(startsWith || !vacancyOk ? "candidate" : "vacancy");
  const [participationId, setParticipationId] = useState<string | null>(startsWith);
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const intent = useRef<{ file: File; target: string | null; key: string } | null>(null);

  const canUploadToPerson = participations.some(entry => entry.scope_allowed_actions.includes("upload"));
  const destinations: ChoiceOption[] = [
    { value: "vacancy", title: "La vacante", description: "Contratos, tabuladores y solicitudes del cliente", leading: <Briefcase />, disabled: !vacancyOk,
      disabledReason: blocked(scope.upload_blocked_reason, "Esta vacante", scope.limits.max_documents) ?? "No puedes subir documentos a la vacante." },
    { value: "candidate", title: "Una persona candidata", description: "Carta de renuncia, alta IMSS y su expediente", leading: <User />, disabled: !canUploadToPerson,
      disabledReason: "Ninguna persona candidata puede recibir documentos ahora." },
  ];
  const person = participations.find(entry => entry.participation_id === participationId);
  const target = dest === "vacancy" ? null : participationId;
  const personBlocked = dest === "candidate" && person && !person.scope_allowed_actions.includes("upload") ? blocked(person.upload_blocked_reason, "Esta persona", scope.limits.max_documents) : null;
  const ready = file !== null && fileError === null && (dest === "vacancy" ? vacancyOk : person?.scope_allowed_actions.includes("upload") === true);

  async function submit() {
    if (!file || !ready) return;
    // One key per intent (this file for this destination): a retry replays the first answer, a different file or destination is a new intent.
    if (intent.current?.file !== file || intent.current.target !== target) intent.current = { file, target, key: crypto.randomUUID() };
    setFailure(null); setProgress(0);
    const result = await uploadDocumentFile({ draftId, participationId: target, file, idempotencyKey: intent.current.key, onProgress: setProgress });
    setProgress(null);
    if (result.ok) { onUploaded(result.data, target); return; }
    if (result.fields?.file) setFileError(result.fields.file); else setFailure(result.message);
    if (result.reload) onReload();
  }

  return <Dialog open onOpenChange={next => { if (!next && progress === null) onClose(); }}>
    <DialogContent finalFocus={finalFocus} className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg">
      <DialogHeader><DialogTitle>Subir documento</DialogTitle><DialogDescription>Los ven tu equipo y los stakeholders de la empresa; el candidato nunca.</DialogDescription></DialogHeader>
      <div className="flex flex-col gap-3">
        <ChoiceList legend="¿A quién pertenece?" value={dest} onValueChange={next => { setDest(next as Dest); setFailure(null); }} options={destinations} />
        {dest === "candidate" && <div className="flex flex-col gap-2"><CandidatePicker id="upload-candidate" label="Candidato" participations={participations} value={participationId} onChange={setParticipationId}
          placeholder="Busca a una persona" className="min-h-10 w-full" isItemDisabled={entry => !entry.scope_allowed_actions.includes("upload")} />
          {personBlocked && <p className="text-sm text-muted-foreground">{personBlocked}</p>}</div>}
      </div>
      <DocumentFileField limits={scope.limits} file={file} error={fileError} disabled={progress !== null}
        onFile={next => { setFile(next); setFailure(null); setFileError(next ? checkFile(next, scope.limits) : null); }} />
      {progress !== null && <Progress value={Math.round(progress * 100)}><ProgressLabel>Subiendo {file?.name}</ProgressLabel><ProgressValue /></Progress>}
      {failure && <p role="alert" className="text-sm text-status-danger">{failure}</p>}
      <DialogFooter>
        <Button type="button" variant="outline" className="min-h-10" disabled={progress !== null} onClick={onClose}>Cancelar</Button>
        <Button type="button" className="min-h-10" disabled={!ready || progress !== null} onClick={submit}><Upload aria-hidden="true" />Subir</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
