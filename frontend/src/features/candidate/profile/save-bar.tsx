"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { listText } from "./sections";
import styles from "./profile.module.css";

export const NEW_PROFILE_NOTE = "Se crea al guardar, aunque falten datos.";

/**
 * The save bar: only while something is unsaved, the profile does not exist yet, or a save is in flight or
 * uncertain. It names the changed tabs in one line and holds Restaurar, Guardar perfil and, when needed, Comprobar.
 * `data-pf-draft-save-bar` lifts the app toasts above it (globals.css), the module rule adds room at 390 px.
 */
export function SaveBar({ changed, isNew, pending, uncertain, children }: { changed: readonly string[]; isNew: boolean; pending: boolean; uncertain: boolean; children: ReactNode }) {
  const title = pending ? "Guardando tu perfil…" : changed.length ? "Cambios sin guardar" : uncertain ? "No pudimos confirmar si se guardó" : "Tu perfil todavía no existe";
  const where = !pending && changed.length ? `En ${listText(changed)}` : "";
  return <div role="region" aria-label={isNew && !changed.length ? "Crear tu perfil" : "Cambios sin guardar"} data-pf-profile-savebar="" data-pf-draft-save-bar=""
    className={cn("sticky bottom-2 z-20 flex min-w-0 flex-wrap items-center gap-3 rounded-[18px] bg-popover p-3 text-sm sm:bottom-4 sm:rounded-[20px] sm:py-2.5 sm:pr-2.5 sm:pl-5", styles.bar)}>
    <p className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2.5 gap-y-0.5 sm:min-w-50">
      <b className="font-semibold">{title}</b>
      {where && <span className="text-[13px] text-muted-foreground">{where}</span>}
      {isNew && !pending && <span className="text-[13px] text-muted-foreground">{NEW_PROFILE_NOTE}</span>}
    </p>
    <div className="grid w-full auto-cols-fr grid-flow-col gap-2 sm:flex sm:w-auto sm:flex-wrap max-sm:*:min-h-11 max-sm:*:px-2.5 max-sm:*:whitespace-normal">{children}</div>
  </div>;
}
