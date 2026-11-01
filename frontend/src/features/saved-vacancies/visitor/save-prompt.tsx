"use client";
import { useState, type ReactElement } from "react";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { Popover, PopoverTrigger, PopoverContent, PopoverHeader, PopoverTitle, PopoverDescription } from "@/components/ui/popover";
import { candidateAuthHref, safeReturnTo } from "@/features/identity/return-to";

export function VisitorSavePrompt({ jobId, returnTo, trigger }: { jobId: string; returnTo: string; trigger: ReactElement }) {
  const [open, setOpen] = useState(false);
  const safe = safeReturnTo(returnTo) ?? "/vacantes";
  const [path, query = ""] = safe.split("?");
  const params = new URLSearchParams(query);
  params.set("guardar", jobId);
  const next = `${path}?${params}`;
  // Official popover Basic composition; the native trigger remains the joined
  // detail button. Base UI owns positioning, dismissal and focus restoration.
  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger render={trigger} />
    <PopoverContent data-visitor-save={open ? "" : undefined} align="end" className="max-w-[calc(100vw-2rem)]" finalFocus>
      {open && <><PopoverHeader>
        <PopoverTitle>Guarda vacantes para verlas después</PopoverTitle>
        <PopoverDescription>Crea una cuenta o inicia sesión. Volverás a esta misma página y la vacante quedará guardada.</PopoverDescription>
      </PopoverHeader>
      <div className="flex flex-wrap gap-2">
        <Link className={buttonVariants({ size: "lg" })} href={candidateAuthHref("ingresar", next)}>Crear cuenta</Link>
        <Link className={buttonVariants({ variant: "outline", size: "lg" })} href={candidateAuthHref("login", next)}>Iniciar sesión</Link>
      </div></>}
    </PopoverContent>
  </Popover>;
}
