"use client";
import { useEffect, useRef, useState } from "react";
import { FileText } from "lucide-react";
import { ActionBar, ActionStatus } from "@/components/feedback/action-status";
import { notifyActionResult } from "@/components/feedback/notify";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { renameCvAction, deleteCvAction } from "./actions";
import { RoleBlocked } from "@/features/identity/identity-states";
import { failureCopy, failureStatus, uncertain } from "./feedback";
import { normalizeCvName, validCvName, type Cv, type CvFailure } from "./model";
export function CvDialog({ cv, mode, onClose, onSaved, onCheck, onWrongRole }: {
  cv: Cv; mode: "rename" | "delete"; onClose: () => void; onSaved: (cv: Cv | null) => void; onCheck: () => Promise<boolean>; onWrongRole?: (failure: CvFailure) => void;
}) {
  const [name, setName] = useState(cv.name);
  const [fieldError, setFieldError] = useState<string>();
  const [failure, setFailure] = useState<CvFailure>();
  const [pending, setPending] = useState(false);
  const [checking, setChecking] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { if (fieldError && !pending) input.current?.focus(); }, [fieldError, pending]);
  const isRename = mode === "rename";
  const isUncertain = failure && uncertain(failure);
  const statusId = `cv-${mode}-status`;
  const copy = failure ? failureCopy(failure, 10, "edit") : undefined;
  const close = () => { if (!pending && !checking) onClose(); };
  async function submit() {
    if (pending || isUncertain) return;
    const normalized = normalizeCvName(name);
    if (isRename && !validCvName(normalized)) {
      setFieldError("Escribe un nombre de 1 a 120 caracteres."); input.current?.focus(); return;
    }
    setFieldError(undefined); setFailure(undefined); setPending(true);
    let result;
    try { result = isRename ? await renameCvAction(cv.id, { name: normalized }) : await deleteCvAction(cv.id); }
    catch { result = { ok: false, reason: "no_response", reference: {} } as const; }
    setPending(false);
    if (!result.ok) {
      setFailure(result);
      if (result.reason === "wrong_role") onWrongRole?.(result);
      if (isRename && result.reason === "invalid_request") { setFieldError("Revisa el nombre del CV."); input.current?.focus(); }
      notifyActionResult({ key: `cv-${mode}`, type: "error", ...failureCopy(result, 10, "edit"), reference: { ...result.reference, at: new Date().toISOString() } });
      return;
    }
    notifyActionResult({ key: `cv-${mode}`, type: "success", title: isRename ? "Nombre actualizado" : "CV eliminado", description: isRename ? "El nombre cambió en tu biblioteca. Tus postulaciones conservan su copia." : "El CV salió de tu biblioteca. Tus postulaciones conservan su copia." });
    onSaved(result.data); onClose();
  }
  async function check() {
    setChecking(true);
    try { if (await onCheck()) onClose(); } finally { setChecking(false); }
  }
  if (failure?.reason === "wrong_role") return <RoleBlocked kind="recruiter" />;
  return (
    <Dialog open onOpenChange={open => { if (!open) close(); }}>
      <DialogContent showCloseButton={!pending && !checking}>
        <DialogHeader>
          <DialogTitle>{isRename ? "Renombrar CV" : "Eliminar CV"}</DialogTitle>
          <DialogDescription>{isRename ? "Cambia solo el nombre en tu biblioteca." : "Las postulaciones que ya enviaste conservan su copia de este CV."}</DialogDescription>
        </DialogHeader>
        <div data-pf-cv-dialog-document className="flex min-w-0 flex-wrap items-center gap-3">
          <FileText aria-hidden="true" className="size-5 shrink-0" />
          <div className="min-w-0 flex-1"><p className="text-[12.5px] text-muted-foreground">Documento</p><p className="break-words font-medium">{cv.name}</p></div>
          {cv.in_use && <Badge variant="neutral">En uso</Badge>}
        </div>
        <form onSubmit={event => { event.preventDefault(); void submit(); }} className="flex flex-col gap-6">
          {isRename && <FieldGroup><Field data-invalid={!!fieldError} data-disabled={pending || checking}>
            <FieldLabel htmlFor="cv-rename">Nombre del CV</FieldLabel>
            <Input ref={input} id="cv-rename" value={name} disabled={pending || checking} aria-invalid={!!fieldError} aria-describedby={fieldError ? "cv-name-error" : undefined} onChange={event => { setName(event.target.value); setFieldError(undefined); }} className="min-h-10" />
            {fieldError && <FieldError id="cv-name-error">{fieldError}</FieldError>}
          </Field></FieldGroup>}
          <DialogFooter className="[&_[data-pf-action-bar-actions]]:min-w-0 [&_[data-pf-action-bar-actions]]:shrink [&_[data-pf-action-bar-actions]]:max-sm:flex-1 [&_[data-pf-action-bar-actions]]:max-sm:flex-col">
            <ActionBar status={copy ? <ActionStatus id={statusId} tone="error" text={failureStatus(failure!, copy)} action={failure?.reason === "unauthenticated" ? <a href="/candidato/login" className="inline-flex min-h-10 items-center underline">Iniciar sesión</a> : undefined} /> : null}>
              <Button type="button" variant="outline" className="min-h-10 w-full sm:w-auto" disabled={pending || checking} onClick={close}>Cancelar</Button>
              {isUncertain ? <Button type="button" className="min-h-10 w-full sm:w-auto" disabled={checking} onClick={() => void check()} aria-describedby={copy ? statusId : undefined}>{checking && <Spinner aria-hidden="true" data-icon="inline-start" />}Comprobar</Button> : <Button type="submit" variant={isRename ? "default" : "destructive"} className="min-h-10 w-full sm:w-auto" disabled={pending} aria-describedby={copy ? statusId : undefined}>
                {pending && <Spinner aria-hidden="true" data-icon="inline-start" />}{pending ? "Guardando…" : isRename ? "Guardar nombre" : "Eliminar CV"}
              </Button>}
            </ActionBar>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
