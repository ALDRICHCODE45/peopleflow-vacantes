"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { MapPin } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { ActionBar, ActionStatus } from "@/components/feedback/action-status";
import { dismissActionResult, notifyActionResult } from "@/components/feedback/notify";
import { locationReadToValue, locationValueToWrite } from "@/features/geo/model";
import type { Company, CompanyEditor } from "./api/company-client";
import { loadCompanyStateAction, updateCompanyLocationAction, type UpdateCompanyLocationState } from "./actions";
import { OptionalLocationField } from "@/features/geo/optional-location-field";

const conflictMessage = "La ubicación cambió. Mostramos la versión actual; revísala antes de guardar.";
const uncertain = (kind?: string) => kind === "server_error" || kind === "no_response" || kind === "unrecognized_response";

export function CompanyLocationDialog({ company, onAdopt }: { company: Company; onAdopt: (value: CompanyEditor) => void }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(() => locationReadToValue(company.location));
  const [updatedAt, setUpdatedAt] = useState(company.updated_at);
  const [result, setResult] = useState<UpdateCompanyLocationState | null>(null);
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  const form = useRef<HTMLFormElement>(null);

  function adopt(current: CompanyEditor) {
    onAdopt(current);
    setValue(locationReadToValue(current.location));
    setUpdatedAt(current.updated_at);
  }
  function failure(next: Exclude<UpdateCompanyLocationState, { kind: "updated" }>) {
    setResult(next);
    notifyActionResult({ key: "company-location", type: "error", title: next.kind === "conflict" ? "Esto cambió en otro lugar" : "No se guardó la ubicación", description: next.kind === "conflict" ? conflictMessage : next.kind === "invalid" ? "Corrige los campos marcados antes de guardar." : next.kind === "unauthenticated" ? "Inicia sesión en otra pestaña. Tus datos siguen aquí." : next.kind === "forbidden" ? "Solo el propietario puede cambiar la ubicación." : "No pudimos confirmar el cambio. Consulta la ubicación actual antes de volver a guardar.", reference: { ...next.reference, at: new Date().toISOString() } });
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy.current || uncertain(result?.kind)) return;
    busy.current = true; setPending(true); setResult(null); dismissActionResult("company-location");
    let next: UpdateCompanyLocationState;
    try { next = await updateCompanyLocationAction({ location: locationValueToWrite(value), updatedAt }); }
    catch { next = { kind: "no_response", reference: {} }; }
    busy.current = false; setPending(false);
    if (next.kind === "updated") {
      adopt(next.company); setOpen(false); setResult(next);
      notifyActionResult({ key: "company-location", type: "success", title: "Ubicación actualizada.", description: "La ubicación de tu empresa quedó guardada." });
    } else {
      if (next.kind === "conflict") adopt(next.company);
      failure(next);
      if (next.kind === "invalid") requestAnimationFrame(() => form.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus());
    }
  }
  async function reconcile() {
    if (busy.current) return;
    busy.current = true; setPending(true);
    try {
      const current = await loadCompanyStateAction();
      if (current.kind === "exists" && current.company.id === company.id && current.role === "owner") {
        adopt(current.company); setResult(null); dismissActionResult("company-location");
      } else failure({ kind: "unrecognized_response", reference: {} });
    } catch { failure({ kind: "no_response", reference: {} }); }
    finally { busy.current = false; setPending(false); }
  }
  return <>
    <Dialog open={open} onOpenChange={next => {
      if (busy.current) return;
      if (next) { setValue(locationReadToValue(company.location)); setUpdatedAt(company.updated_at); }
      setOpen(next);
    }}>
      <DialogTrigger render={<Button type="button" variant="outline" className="min-h-10 w-fit" />}><MapPin data-icon="inline-start" aria-hidden="true" />Editar ubicación</DialogTrigger>
      <DialogContent showCloseButton={false} className="flex max-h-[calc(100dvh-2rem)] flex-col">
        <DialogHeader><DialogTitle>Editar ubicación</DialogTitle><DialogDescription>Actualiza dónde se encuentra tu empresa. Puedes dejarla sin ubicación.</DialogDescription></DialogHeader>
        <form ref={form} id="company-location-edit" onSubmit={submit} className="min-h-0 flex-1 overflow-y-auto" noValidate>
          <OptionalLocationField depth="municipality" postalCode label="Ubicación" description="Opcional." value={value} onChange={setValue} disabled={pending || uncertain(result?.kind)} errors={result?.kind === "invalid" ? result.fields?.location : undefined} />
        </form>
        <DialogFooter><ActionBar status={result && result.kind !== "updated" ? <ActionStatus id="company-location-status" tone="error" text={result.kind === "conflict" ? conflictMessage : "No se guardó · ver aviso"} action={result.kind === "unauthenticated" ? <Link href="/empresa/login" target="_blank" rel="noopener noreferrer" className={buttonVariants({ variant: "outline", className: "min-h-10" })}>Iniciar sesión</Link> : undefined} /> : undefined}>
          <Button type="button" variant="outline" className="min-h-10" disabled={pending} onClick={() => setOpen(false)}>Cancelar</Button>
          {uncertain(result?.kind) ? <Button type="button" className="min-h-10" disabled={pending} onClick={reconcile}>Consultar ubicación</Button> : <Button type="submit" form="company-location-edit" className="min-h-10" disabled={pending} aria-busy={pending} aria-describedby={result ? "company-location-status" : undefined}>{pending && <Spinner data-icon="inline-start" aria-hidden="true" />}{pending ? "Guardando…" : "Guardar ubicación"}</Button>}
        </ActionBar></DialogFooter>
      </DialogContent>
    </Dialog>
    {result?.kind === "updated" && <ActionStatus id="company-location-saved" tone="success" text="Ubicación actualizada." />}
  </>;
}
