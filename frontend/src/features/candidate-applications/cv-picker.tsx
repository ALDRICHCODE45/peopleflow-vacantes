"use client";
import { useEffect, useRef, useState } from "react";
import { FileText, Upload } from "lucide-react";
import { ActionBar, ActionStatus } from "@/components/feedback/action-status";
import { notifyActionResult } from "@/components/feedback/notify";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { loadCvsAction } from "@/features/candidate-cvs/actions";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { uploadCv } from "@/features/candidate-cvs/upload";
import { uploadValidation, type CvFailure, type CvLibrary } from "@/features/candidate-cvs/model";
import { CvStorageUnavailable } from "@/features/candidate-cvs/storage-unavailable";
import { failureCopy, failureStatus, uncertain } from "@/features/candidate-cvs/feedback";
export function CvPicker({ library, selected, onSelect, onLibrary, error, onBusy, onWrongRole }: {
  library: CvLibrary; selected: string; onSelect: (id: string) => void; onLibrary: (library: CvLibrary) => void; error?: string; onBusy: (busy: boolean) => void; onWrongRole: (failure: CvFailure) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const locked = useRef(false);
  const [busy, setBusy] = useState(false);
  const [fileError, setFileError] = useState<string>();
  const [needsCheck, setNeedsCheck] = useState(false);
  const [storageUnavailable, setStorageUnavailable] = useState(false);
  const [status, setStatus] = useState<{ tone: "success" | "error"; text: string }>();
  const checkButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!fileError || busy) return;
    if (needsCheck) checkButton.current?.focus(); else input.current?.focus();
  }, [fileError, busy, needsCheck]);
  async function upload(file?: File) {
    if (!file || locked.current || needsCheck) return;
    const validation = uploadValidation(file, library.limits);
    if (validation) { setFileError(validation); input.current?.focus(); return; }
    locked.current = true; setBusy(true); onBusy(true); setFileError(undefined); setStatus(undefined);
    let result;
    try { result = await uploadCv(file, library.limits); } catch { result = { ok: false, reason: "no_response", reference: {} } as const; }
    locked.current = false; setBusy(false); onBusy(false);
    if (!result.ok) {
      const copy = failureCopy(result, library.limits.max_cvs, "upload");
      setNeedsCheck(uncertain(result));
      setStorageUnavailable(result.reason === "storage_unavailable");
      if (result.reason === "wrong_role") onWrongRole(result);
      if (result.reason !== "storage_unavailable") setFileError(copy.title);
      setStatus({ tone: "error", text: failureStatus(result, copy) }); input.current?.focus();
      notifyActionResult({ key: "apply-cv-upload", type: "error", ...copy, reference: { ...result.reference, at: new Date().toISOString() } }); return;
    }
    onLibrary({ ...library, items: [result.data, ...library.items] }); onSelect(result.data.id);
    setStatus({ tone: "success", text: "CV subido y seleccionado" });
    notifyActionResult({ key: "apply-cv-upload", type: "success", title: "CV subido", description: "El CV está en tu biblioteca y seleccionado para esta postulación." });
  }
  async function checkLibrary() {
    if (locked.current) return;
    locked.current = true; setBusy(true); onBusy(true);
    const result = await loadCvsAction().catch(() => ({ ok: false, reason: "no_response", reference: {} }) as const);
    locked.current = false; setBusy(false); onBusy(false);
    if (result.ok) {
      onLibrary(result.data); setNeedsCheck(false); setFileError(undefined); setStorageUnavailable(false);
      setStatus({ tone: "success", text: "Biblioteca actualizada. Revisa tus CVs." });
      notifyActionResult({ key: "apply-cv-upload", type: "success", title: "Biblioteca actualizada", description: "Revisa si tu CV ya está en la biblioteca antes de subirlo otra vez." });
    } else {
      const copy = failureCopy(result, library.limits.max_cvs, "read");
      if (result.reason === "wrong_role") onWrongRole(result);
      setStorageUnavailable(result.reason === "storage_unavailable");
      setStatus({ tone: "error", text: failureStatus(result, copy) });
      notifyActionResult({ key: "apply-cv-upload", type: "error", ...copy, reference: { ...result.reference, at: new Date().toISOString() } });
    }
  }
  if (storageUnavailable) return <CvStorageUnavailable retry={() => void checkLibrary()} pending={busy} status={status ? <ActionStatus id="apply-cv-upload-status" tone={status.tone} text={status.text} /> : null} statusId="apply-cv-upload-status" />;
  return <FieldGroup>
    <FieldSet>
      <FieldLegend>CV</FieldLegend>
      <FieldDescription>Elige un CV de tu biblioteca. Es obligatorio.</FieldDescription>
      <Field data-invalid={!!error}>
        <ToggleGroup aria-label="CV de tu biblioteca" aria-invalid={!!error} aria-describedby={error ? "cv-choice-error" : undefined} variant="outline" orientation="vertical" className="w-full" value={selected ? [selected] : []} onValueChange={values => { if (values[0]) onSelect(values[0]); }} disabled={busy}>
          {library.items.map(cv => <ToggleGroupItem key={cv.id} value={cv.id} aria-label={cv.name} className="min-h-10 justify-start whitespace-normal break-words"><FileText aria-hidden="true" data-icon="inline-start" />{cv.name}</ToggleGroupItem>)}
        </ToggleGroup>
        {error && <FieldError id="cv-choice-error">{error}</FieldError>}
      </Field>
    </FieldSet>
    <Field data-invalid={!!fileError} data-disabled={busy || needsCheck || library.items.length >= library.limits.max_cvs}>
      <FieldLabel htmlFor="apply-cv-upload"><Upload aria-hidden="true" className="size-4" />Subir un CV nuevo</FieldLabel>
      <Input ref={input} id="apply-cv-upload" type="file" accept={`${library.limits.content_types.join(",")},.pdf,.docx`} disabled={busy || needsCheck || library.items.length >= library.limits.max_cvs} className="min-h-10" aria-invalid={!!fileError} aria-describedby="apply-cv-upload-help apply-cv-upload-error apply-cv-upload-status" onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; void upload(file); }} />
      <FieldDescription id="apply-cv-upload-help">PDF o Word (.docx), hasta {library.limits.max_bytes / 1024 / 1024} MB. {library.items.length} de {library.limits.max_cvs} CVs en tu biblioteca. Cada postulación conserva su copia.</FieldDescription>
      {fileError && <FieldError id="apply-cv-upload-error">{fileError}</FieldError>}
      <ActionBar status={status ? <ActionStatus id="apply-cv-upload-status" tone={status.tone} text={status.text} /> : null}>{needsCheck ? <Button ref={checkButton} variant="outline" className="min-h-10" disabled={busy} aria-describedby="apply-cv-upload-status" onClick={() => void checkLibrary()}>{busy && <Spinner aria-hidden="true" data-icon="inline-start" />}Comprobar biblioteca</Button> : busy && <Spinner aria-label="Subiendo CV" />}</ActionBar>
    </Field>
  </FieldGroup>;
}
