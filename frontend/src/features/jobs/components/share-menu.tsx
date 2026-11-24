"use client";

import { useId, useState } from "react";
import { CopyIcon, BriefcaseBusinessIcon, MailIcon, MessageCircleIcon, Share2Icon, SquareArrowOutUpRightIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { notifyActionResult } from "@/components/feedback/notify";
import { cn } from "@/lib/utils";
import { shareHeadline, shareLinks, shareUrl, type ShareInput } from "./share-links";

type Props = Omit<ShareInput, "url"> & {
  /** Path or absolute URL of the page to share; defaults to the current page. */
  url?: string;
  label?: string;
  /** Icon-only trigger (headers); the label stays its accessible name. */
  iconOnly?: boolean;
  /** Show the copy outcome next to the trigger (detail card); otherwise it is read out and toasted. */
  visibleStatus?: boolean;
  className?: string;
  variant?: "ghost" | "outline";
};

const EXTERNAL = { target: "_blank", rel: "noopener noreferrer" } as const;

/** Share menu: copy link, WhatsApp, mail, LinkedIn and, where the browser has it, the system sheet. Everything runs on activation only. */
export function ShareMenu({ title, company, intro, url, label = "Compartir vacante", iconOnly = false, visibleStatus = false, className, variant = "ghost" }: Props) {
  const [message, setMessage] = useState("");
  const statusId = useId();
  const resolve = () => shareUrl(url ?? window.location.href, window.location.origin);
  async function copy() {
    try {
      await navigator.clipboard.writeText(resolve());
      setMessage("Enlace copiado");
      if (!visibleStatus) notifyActionResult({ key: "share-link", type: "success", title: "Enlace copiado" });
    } catch {
      setMessage("Copia la dirección de esta página para compartirla.");
      if (!visibleStatus) notifyActionResult({ key: "share-link", type: "error", title: "No pudimos copiar el enlace", description: "Copia la dirección de esta página para compartirla." });
    }
  }
  return <div className={cn("flex flex-col gap-1", iconOnly && "contents")}>
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button type="button" variant={variant} size={iconOnly ? "icon" : "default"} className={cn(iconOnly ? "size-10" : "min-h-11 w-full", className)} aria-label={iconOnly ? label : undefined} aria-describedby={statusId} />}>
        <Share2Icon aria-hidden="true" data-icon={iconOnly ? undefined : "inline-start"} />{!iconOnly && label}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-52"><ShareItems input={{ title, company, intro, url: "" }} resolve={resolve} onCopy={() => void copy()} /></DropdownMenuContent>
    </DropdownMenu>
    <p id={statusId} role="status" className={visibleStatus ? "text-center text-sm text-muted-foreground empty:h-0" : "sr-only"}>{message}</p>
  </div>;
}

/** Rendered only while the menu is open, so reading `window` here never runs on the server. */
function ShareItems({ input, resolve, onCopy }: { input: ShareInput; resolve: () => string; onCopy: () => void }) {
  const url = resolve();
  const links = shareLinks({ ...input, url });
  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";
  return <DropdownMenuGroup>
    <DropdownMenuItem className="min-h-10" onClick={onCopy}><CopyIcon aria-hidden="true" />Copiar enlace</DropdownMenuItem>
    <DropdownMenuItem className="min-h-10" render={<a href={links.whatsapp} {...EXTERNAL} />}><MessageCircleIcon aria-hidden="true" />WhatsApp</DropdownMenuItem>
    <DropdownMenuItem className="min-h-10" render={<a href={links.email} />}><MailIcon aria-hidden="true" />Correo</DropdownMenuItem>
    <DropdownMenuItem className="min-h-10" render={<a href={links.linkedin} {...EXTERNAL} />}><BriefcaseBusinessIcon aria-hidden="true" />LinkedIn</DropdownMenuItem>
    {canShare && <DropdownMenuItem className="min-h-10" onClick={() => { void navigator.share({ title: shareHeadline(input), url }).catch(() => undefined); }}><SquareArrowOutUpRightIcon aria-hidden="true" />Más opciones…</DropdownMenuItem>}
  </DropdownMenuGroup>;
}
