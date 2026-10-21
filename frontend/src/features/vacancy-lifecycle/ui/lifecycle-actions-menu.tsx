"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronDown, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ActionStatus } from "@/components/feedback/action-status";
import { notifyActionResult } from "@/components/feedback/notify";
import { getLifecycleAction } from "../actions";
import type { Lifecycle } from "../model";
import { LifecycleActionDialog, LIFECYCLE_ACTION_UI, type LifecycleSnapshot, type TransitionAction } from "./lifecycle-action-dialog";

/** No local role/transition table: every opening gets the current actor's allowed_actions. */
export function LifecycleActionsMenu({ draftId, title, onChanged, children, onPublish }: {
  draftId: string; title: string; onChanged: (view: Lifecycle) => void; children?: ReactNode; onPublish?: () => void;
}) {
  const [snapshot, setSnapshot] = useState<LifecycleSnapshot | null>(null);
  const [selected, setSelected] = useState<TransitionAction | null>(null);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const generation = useRef(0);
  useEffect(() => () => { generation.current++; }, [draftId]);
  async function load() {
    const current = ++generation.current;
    setSnapshot(null); setMessage(null); setPending(true);
    try {
      const result = await getLifecycleAction(draftId);
      if (current !== generation.current) return;
      if (result.ok) { setSnapshot(result); onChanged(result.data); }
      else {
        setMessage(result.message);
        notifyActionResult({ key: `lifecycle-${draftId}`, type: "error", title: result.message, description: "No se modificó la vacante.", reference: { ...result.reference, at: new Date().toISOString() } });
      }
    } catch {
      if (current === generation.current) setMessage("No pudimos consultar el estado. Vuelve a abrir Acciones para reintentar.");
    } finally { if (current === generation.current) setPending(false); }
  }
  return <>
    <DropdownMenu onOpenChange={open => { if (open) void load(); }}>
      <DropdownMenuTrigger render={<Button type="button" variant="outline" size="sm" className="h-10 gap-1.5 px-3.5" aria-label={`Acciones de ${title}`} />}>Acciones<ChevronDown aria-hidden="true" data-icon="inline-end" /></DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-52">
        {children}
        {pending && <p role="status" className="p-2 text-sm text-muted-foreground">Consultando acciones…</p>}
        <DropdownMenuGroup>
          {snapshot?.data.allowed_actions.map(action => {
            if (action === "publish") return onPublish ? <DropdownMenuItem key={action} onClick={onPublish}><Send aria-hidden="true" />Publicar</DropdownMenuItem> : null;
            const ui = LIFECYCLE_ACTION_UI[action];
            return <DropdownMenuItem key={action} onClick={() => setSelected(action)}><ui.icon aria-hidden="true" />{ui.label}</DropdownMenuItem>;
          })}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
    {message && <ActionStatus id={`lifecycle-menu-${draftId}`} tone="error" text={message} />}
    {selected && snapshot && <LifecycleActionDialog draftId={draftId} title={title} action={selected} snapshot={snapshot} open onOpenChange={open => { if (!open) { setSelected(null); setSnapshot(null); } }} onChanged={onChanged} />}
  </>;
}
