"use client";

import { useEffect, useRef, useState } from "react";
import { LogOut } from "lucide-react";
import { ConfirmActionDialog } from "@/components/feedback/confirm-action-dialog";

/** Capture ordinary links before Next handles them; never patch router/history APIs.
 * Browser back and imperative router navigation have no supported App Router blocker.
 */
export function DraftLeaveGuard({ dirty }: { dirty: boolean }) {
  const [destination, setDestination] = useState<HTMLAnchorElement | null>(null);
  const permitted = useRef(false);
  useEffect(() => {
    if (!dirty) return;
    function unload(event: BeforeUnloadEvent) {
      if (permitted.current) return;
      event.preventDefault(); event.returnValue = "";
    }
    function follow(event: MouseEvent) {
      if (permitted.current || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (!(link instanceof HTMLAnchorElement) || link.download || (link.target && link.target !== "_self") || link.origin !== location.origin) return;
      if (link.pathname === location.pathname && link.search === location.search) return;
      event.preventDefault(); event.stopPropagation(); setDestination(link);
    }
    window.addEventListener("beforeunload", unload);
    document.addEventListener("click", follow, true);
    return () => { window.removeEventListener("beforeunload", unload); document.removeEventListener("click", follow, true); };
  }, [dirty]);
  return <ConfirmActionDialog open={destination !== null && dirty} onOpenChange={open => { if (!open) setDestination(null); }}
    icon={LogOut} title="¿Salir sin guardar?" description="Perderás los cambios que no guardaste."
    confirmLabel="Salir sin guardar" tone="destructive" finalFocus={() => destination}
    onConfirm={() => {
      const link = destination; setDestination(null);
      permitted.current = true;
      link?.click();
      // Only this confirmed navigation may bypass the guard, not later edits.
      window.setTimeout(() => { permitted.current = false; }, 0);
    }} />;
}
