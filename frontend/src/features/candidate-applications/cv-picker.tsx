"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { FileText, Upload } from "lucide-react";
import { ChoiceList } from "@/components/ui/choice-list";
import { FileField } from "@/components/ui/file-field";
import { SectionEmpty } from "@/components/feedback/state-card";
import { ActionBar, ActionStatus } from "@/components/feedback/action-status";
import { notifyActionResult } from "@/components/feedback/notify";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { loadCvsAction } from "@/features/candidate-cvs/actions";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { uploadCv } from "@/features/candidate-cvs/upload";
import { uploadValidation, type CvFailure, type CvLibrary } from "@/features/candidate-cvs/model";
import { CvStorageUnavailable } from "@/features/candidate-cvs/storage-unavailable";
import { failureCopy, failureStatus, uncertain } from "@/features/candidate-cvs/feedback";
export function CvPicker({ library, selected, onSelect, onLibrary, error, onBusy, onWrongRole }: {
  library: CvLibrary; selected: string; onSelect: (id: string) => void; onLibrary: (library: CvLibrary) => void; error?: string; onBusy: (busy: boolean) => void; onWrongRole: (failure: CvFailure) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [file, setFile] = useState<File | null>(null);
  // The native input stays hidden inside the shared FileField; keyboard focus goes to its visible button.
  const nativeInput = useCallback(() => box.current?.querySelector<HTMLInputElement>('input[type="file"]') ?? null, []);
  const focusField = useCallback(() => (box.current?.querySelector<HTMLElement>('[data-slot="file-field-zone"] button') ?? nativeInput())?.focus(), [nativeInput]);
  const locked = useRef(false);
  const [busy, setBusy] = useState(false);
  const [fileError, setFileError] = useState<string>();
  const [needsCheck, setNeedsCheck] = useState(false);
  const [storageUnavailable, setStorageUnavailable] = useState(false);
  const [status, setStatus] = useState<{ tone: "success" | "error"; text: string }>();
  const checkButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!fileError || busy) return;
    if (needsCheck) checkButton.current?.focus(); else focusField();
  }, [fileError, busy, needsCheck, focusField]);
  async function upload(file?: File) {
    if (!file || locked.current || needsCheck) return;
    const validation = uploadValidation(file, library.limits);
    if (validation) { setFileError(validation); focusField(); return; }
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
      setStatus({ tone: "error", text: failureStatus(result, copy) }); focusField();
      notifyActionResult({ key: "apply-cv-upload", type: "error", ...copy, reference: { ...result.reference, at: new Date().toISOString() } }); return;
    }
    setFile(null); onLibrary({ ...library, items: [result.data, ...library.items] }); onSelect(result.data.id);
    setStatus({ tone: "success", text: "CV subido y seleccionado" });
    notifyActionResult({ key: "apply-cv-upload", type: "success", title: "CV subido", description: "El CV está en tu biblioteca y seleccionado para esta postulación." });
  }
  async function checkLibrary() {
    if (locked.current) return;
    locked.current = true; setBusy(true); onBusy(true);
    const result = await loadCvsAction().catch(() => ({ ok: false, reason: "no_response", reference: {} }) as const);
    locked.current = false; setBusy(false); onBusy(false);
    if (result.ok) {
      onLibrary(result.data); setFile(null); setNeedsCheck(false); setFileError(undefined); setStorageUnavailable(false);
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
  const uploadDisabled = busy || needsCheck || library.items.length >= library.limits.max_cvs;
  const accept = `${library.limits.content_types.join(",")},.pdf,.docx`;
  const limitsHint = `PDF o Word (.docx), hasta ${library.limits.max_bytes / 1024 / 1024} MB. ${library.items.length} de ${library.limits.max_cvs} CVs en tu biblioteca. Cada postulación conserva su copia.`;
  if (storageUnavailable) return <CvStorageUnavailable retry={() => void checkLibrary()} pending={busy} status={status ? <ActionStatus id="apply-cv-upload-status" tone={status.tone} text={status.text} /> : null} statusId="apply-cv-upload-status" />;
  return <FieldGroup>
    <FieldSet>
      <FieldLegend>CV</FieldLegend>
      {library.items.length === 0 ? <SectionEmpty icon={FileText} tone="empty" title="Todavía no tienes un CV"
        description="Sube tu CV para completar esta postulación. Se agregará a tu biblioteca y quedará seleccionado para esta vacante."
        primaryAction={{ label: "Subir CV", disabled: busy || needsCheck, onClick: () => nativeInput()?.click() }} /> : <FieldDescription>Elige un CV de tu biblioteca. Es obligatorio.</FieldDescription>}
      <Field data-invalid={!!error}>
        {library.items.length > 0 && <ChoiceList legend="CV de tu biblioteca" hideLegend disabled={busy} error={error} value={selected || null} onValueChange={onSelect}
          options={library.items.map(cv => ({ value: cv.id, title: cv.name, leading: <FileText /> }))} />}
      </Field>
    </FieldSet>
    <Field ref={box} data-invalid={!!fileError} data-disabled={uploadDisabled}>
      {library.items.length === 0 ? <>
        <FieldLabel className="sr-only" htmlFor="apply-cv-upload"><Upload aria-hidden="true" className="size-4" />Subir un CV nuevo</FieldLabel>
        <Input id="apply-cv-upload" type="file" accept={accept} disabled={uploadDisabled} className="sr-only" aria-invalid={!!fileError} aria-describedby="apply-cv-upload-help apply-cv-upload-error apply-cv-upload-status" onChange={event => { const picked = event.target.files?.[0]; event.target.value = ""; void upload(picked); }} />
        <FieldDescription id="apply-cv-upload-help">{limitsHint}</FieldDescription>
        {fileError && <FieldError id="apply-cv-upload-error">{fileError}</FieldError>}
      </> : <FileField label="Subir un CV nuevo" value={file} accept={accept} disabled={uploadDisabled} hint={limitsHint} error={fileError}
        onChange={picked => { setFile(picked); if (picked) void upload(picked); else setFileError(undefined); }} />}
      <ActionBar status={status ? <ActionStatus id="apply-cv-upload-status" tone={status.tone} text={status.text} /> : null}>{needsCheck ? <Button ref={checkButton} variant="outline" className="min-h-10" disabled={busy} aria-describedby="apply-cv-upload-status" onClick={() => void checkLibrary()}>{busy && <Spinner aria-hidden="true" data-icon="inline-start" />}Comprobar biblioteca</Button> : busy && <Spinner aria-label="Subiendo CV" />}</ActionBar>
    </Field>
  </FieldGroup>;
}
