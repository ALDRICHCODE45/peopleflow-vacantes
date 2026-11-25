"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { Pencil, X } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { SheetClose, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Spinner } from "@/components/ui/spinner";
import { useIsMobile } from "@/hooks/use-mobile";
import { ActionStatus } from "@/components/feedback/action-status";
import { dismissActionResult, notifyActionResult } from "@/components/feedback/notify";
import { locationReadToValue, locationValueToWrite } from "@/features/geo/model";
import type { Company, CompanyEditor } from "./api/company-client";
import { loadCompanyStateAction, updateCompanyLocationAction, type UpdateCompanyLocationState } from "./actions";
import { OptionalLocationField } from "@/features/geo/optional-location-field";
import { cn } from "@/lib/utils";

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
  const isMobile = useIsMobile();

  function changeLocation(next: typeof value) {
    setValue(next);
    setResult(current => current?.kind === "invalid" ? {
      ...current,
      fields: { ...current.fields, location: current.fields?.location?.filter(issue => next[issue.field] === value[issue.field]) },
    } : current);
  }
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
  const title = "Ubicación de la empresa";
  const description = "Elige dónde se encuentra tu empresa. Puedes dejarla sin ubicación.";
  const fields = <form ref={form} id="company-location-edit" onSubmit={submit} className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1 pb-1 [scrollbar-width:thin]" noValidate>
    <OptionalLocationField depth="municipality" postalCode label="Ubicación" hideLegend value={value} onChange={changeLocation} disabled={pending || uncertain(result?.kind)} errors={result?.kind === "invalid" ? result.fields?.location : undefined} />
    {result?.kind === "conflict" && <ActionStatus id="company-location-status" tone="error" text={conflictMessage} />}
    {result?.kind === "unauthenticated" && <Link href="/empresa/login" target="_blank" rel="noopener noreferrer" className={cn(buttonVariants({ variant: "outline", className: "min-h-10" }))}>Iniciar sesión</Link>}
  </form>;
  const save = uncertain(result?.kind)
    ? <Button type="button" className="min-h-10" disabled={pending} onClick={reconcile}>Consultar ubicación</Button>
    : <Button type="submit" form="company-location-edit" className="min-h-10" disabled={pending} aria-busy={pending} aria-describedby={result?.kind === "conflict" ? "company-location-status" : undefined}>{pending && <Spinner data-icon="inline-start" aria-hidden="true" />}{pending ? "Guardando…" : "Guardar ubicación"}</Button>;
  return <>
    {/* One Base UI dialog, two presentations (artboard settings-redesign/02): a bottom sheet on phones, a centred dialog from the tablet up. */}
    <Dialog open={open} onOpenChange={next => {
      if (busy.current) return;
      if (next) { setValue(locationReadToValue(company.location)); setUpdatedAt(company.updated_at); }
      setOpen(next);
    }}>
      {/* The quiet link-style action of the identity strip (artboard settings-redesign/02): same dialog, no extra card. `pl-0` beats the inline-start icon padding so the link lines up with the facts above. */}
      <DialogTrigger render={<Button type="button" variant="link" className="h-auto min-h-10 w-fit justify-start px-0 text-[13px] has-data-[icon=inline-start]:pl-0" />}><Pencil data-icon="inline-start" aria-hidden="true" className="size-3" />Editar ubicación</DialogTrigger>
      {isMobile
        ? <SheetContent side="bottom" showCloseButton={false} className="max-h-[min(44rem,calc(100dvh-1rem))] gap-0">
          <SheetHeader className="border-b pr-16">
            <SheetTitle>{title}</SheetTitle>
            <SheetDescription>{description}</SheetDescription>
            <SheetClose render={<Button type="button" variant="ghost" size="icon" aria-label="Cerrar" disabled={pending} className="absolute top-4 right-4 size-10 bg-secondary" />}><X aria-hidden="true" /></SheetClose>
          </SheetHeader>
          <div className="flex min-h-0 flex-1 flex-col px-4 py-4">{fields}</div>
          {/* §20: validation belongs to fields and toast, not a footer status line. */}
          <SheetFooter className="flex-row flex-wrap items-center justify-end border-t px-4 pb-4 [&>[data-slot=button]]:min-h-11 [&>[data-slot=button]]:flex-1">
            <DialogClose render={<Button type="button" variant="outline" className="min-h-10" disabled={pending} />}>Cancelar</DialogClose>
            {save}
          </SheetFooter>
        </SheetContent>
        : <DialogContent className="flex max-h-[min(44rem,calc(100dvh-2rem))] flex-col sm:max-w-md">
          {/* pr-12 keeps the description clear of the ✕ (size-10 at right-4). */}
          <DialogHeader className="pr-12"><DialogTitle>{title}</DialogTitle><DialogDescription>{description}</DialogDescription></DialogHeader>
          {fields}
          {/* §20: validation belongs to fields and toast, not a footer status line. */}
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" className="min-h-10" disabled={pending} />}>Cancelar</DialogClose>
            {save}
          </DialogFooter>
        </DialogContent>}
    </Dialog>
    {/* The toast is the visible confirmation; the strip stays slim, so this line only serves assistive technology. */}
    {result?.kind === "updated" && <div className="sr-only"><ActionStatus id="company-location-saved" tone="success" text="Ubicación actualizada." /></div>}
  </>;
}
