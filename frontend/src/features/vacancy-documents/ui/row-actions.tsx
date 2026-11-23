"use client";

import { useRef } from "react";
import { Download, MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import type { Scope } from "../model";
import { participationIdOf } from "./overview-state";
import type { DocRow } from "./rows";

const base = (draftId: string, participationId: string | null) =>
  `/api/company/job-drafts/${draftId}${participationId ? `/participations/${participationId}` : ""}`;
/**
 * BFF download of the current version of an item, or the pinned version of a link (always an attachment). The anchors have NO `download`
 * attribute on purpose: the route answers a failure to a navigation with a redirect back to the tab (`?download_error=`), and a
 * `download` link would save that redirect target, or the JSON body, as the file.
 */
export function fileHref(draftId: string, row: DocRow): string {
  const prefix = base(draftId, participationIdOf(row.owner));
  return row.kind === "item" ? `${prefix}/documents/${row.id}/file` : `${prefix}/document-links/${row.id}/file`;
}
export const versionHref = (draftId: string, participationId: string | null, documentId: string, version: number): string =>
  `${base(draftId, participationId)}/documents/${documentId}/versions/${version}/file`;

export type RowIntent = "replace" | "delete" | "unlink";
/** Only what the item or the link says it allows (`allowed_actions`); there is no role table in the client. */
export function RowActions({ draftId, row, limits, onIntent }: { draftId: string; row: DocRow; limits: Scope["limits"]; onIntent: (intent: RowIntent, row: DocRow, trigger: HTMLElement | null) => void }) {
  const trigger = useRef<HTMLButtonElement>(null);
  const allowed: readonly string[] = row.kind === "item" ? row.item.allowed_actions : row.link.allowed_actions;
  const name = (row.kind === "item" ? row.item.name : row.link.source?.name) ?? "vínculo";
  const atMaxVersions = row.kind === "item" && row.item.version_count >= limits.max_versions;
  const entries = row.kind === "item"
    ? [allowed.includes("replace") && { intent: "replace" as const, label: "Nueva versión", disabled: atMaxVersions },
       allowed.includes("delete") && { intent: "delete" as const, label: "Eliminar documento", destructive: true }]
    : [allowed.includes("unlink") && { intent: "unlink" as const, label: "Desvincular", destructive: true }];
  const menu = entries.filter(entry => entry !== false);
  return <div className="flex items-center justify-end gap-1">
    {allowed.includes("download") && <Button variant="ghost" size="icon" className="size-10" nativeButton={false} role="link"
      render={<a href={fileHref(draftId, row)} aria-label={`Descargar ${name}${row.kind === "link" ? " (versión fijada)" : ""}`} />}><Download aria-hidden="true" /></Button>}
    {menu.length > 0 && <DropdownMenu>
      <DropdownMenuTrigger render={<Button ref={trigger} variant="ghost" size="icon" className="size-10" aria-label={`Más acciones de ${name}`} />}><MoreHorizontal aria-hidden="true" /></DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-auto min-w-56">
        {menu.map(entry => <DropdownMenuItem key={entry.intent} variant={"destructive" in entry ? "destructive" : "default"} disabled={"disabled" in entry && entry.disabled} className="min-h-10"
          onClick={() => onIntent(entry.intent, row, trigger.current)}>
          <span>{entry.label}{"disabled" in entry && entry.disabled && <span className="block text-xs text-muted-foreground">No disponible: llegó a {limits.max_versions} de {limits.max_versions} versiones.</span>}</span>
        </DropdownMenuItem>)}
      </DropdownMenuContent>
    </DropdownMenu>}
  </div>;
}
