"use client";

import { useId, useState } from "react";
import { Share2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Copy only on explicit activation; a persistent live region reports both outcomes. */
export function PublicShareButton() {
  const [message, setMessage] = useState("");
  const statusId = useId();
  async function share() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setMessage("Enlace copiado");
    } catch {
      setMessage("Copia la dirección de esta página para compartirla.");
    }
  }
  return <div className="flex flex-col gap-1">
    <Button type="button" variant="ghost" className="min-h-11 w-full" onClick={share} aria-describedby={statusId}><Share2Icon aria-hidden="true" data-icon="inline-start" />Compartir vacante</Button>
    <p id={statusId} role="status" className="min-h-5 text-center text-sm text-muted-foreground">{message}</p>
  </div>;
}
