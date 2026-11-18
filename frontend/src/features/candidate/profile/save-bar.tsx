"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import styles from "./profile.module.css";

export const NEW_PROFILE_NOTE = "Tu perfil se crea al guardar por primera vez, aunque falten datos.";

/**
 * «Cambios sin guardar»: a bar fixed to the bottom of the view while anything is unsaved (or the profile does not
 * exist yet). It names the changed sections and repeats Restaurar and Guardar perfil so they stay in reach at 390 px.
 */
export function SaveBar({ changed, isNew, pending, uncertain, children }: { changed: readonly string[]; isNew: boolean; pending: boolean; uncertain: boolean; children: ReactNode }) {
  const title = pending ? "Guardando tu perfil…" : changed.length ? "Cambios sin guardar" : uncertain ? "No pudimos confirmar si se guardó" : "Tu perfil todavía no existe";
  return <div role="region" aria-label={isNew && !changed.length ? "Crear tu perfil" : "Cambios sin guardar"} data-pf-profile-savebar=""
    className={cn("sticky bottom-2 z-20 mt-2 flex min-w-0 flex-wrap items-center gap-3 rounded-[18px] bg-popover p-3 text-sm sm:bottom-4 sm:rounded-[20px] sm:pl-5", styles.bar)}>
    <div className="min-w-0 flex-1 sm:min-w-55">
      <p className="font-semibold">{title}</p>
      {changed.length > 0 && <ul aria-label="Secciones con cambios" className="mt-1 flex flex-wrap gap-1">{changed.map(section => <li key={section} className="inline-flex h-5 items-center rounded-full bg-primary/9 px-2 text-[11px] leading-4 font-medium text-primary-text">{section}</li>)}</ul>}
      <p className="mt-1 text-xs text-muted-foreground">{isNew ? NEW_PROFILE_NOTE : "Se guardan juntos; puedes volver a la copia original."}</p>
    </div>
    <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:flex-wrap max-sm:*:min-h-11 max-sm:*:whitespace-normal">{children}</div>
  </div>;
}
