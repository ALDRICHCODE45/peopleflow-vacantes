"use client";
import { createContext, useContext, useId, useState, type ReactNode } from "react";
import { Info, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverDescription, PopoverTitle, PopoverTrigger } from "@/components/ui/popover";
import { competencyCopy, competencyFooter, profileFieldHelp } from "../competency-copy";
import type { Competency } from "../model";

const HelpContext = createContext<{ active: string | null; setActive: (id: string | null) => void } | null>(null);
export function HelpProvider({ children }: { children: ReactNode }) {
  const [active, setActive] = useState<string | null>(null);
  return <HelpContext.Provider value={{ active, setActive }}>{children}</HelpContext.Provider>;
}
export function InfoPopover({ title, description, footer, accessibleName }: { title: string; description: string; footer?: string; accessibleName: string }) {
  const id = useId();
  const group = useContext(HelpContext);
  const [localOpen, setLocalOpen] = useState(false);
  const open = group ? group.active === id : localOpen;
  function changeOpen(next: boolean) {
    if (group) { if (next || group.active === id) group.setActive(next ? id : null); }
    else setLocalOpen(next);
  }
  return <Popover open={open} onOpenChange={changeOpen}>
    <PopoverTrigger render={<Button type="button" variant="ghost" size="icon" className="size-10 shrink-0 text-muted-foreground aria-expanded:text-primary" aria-label={accessibleName} />}><Info aria-hidden="true" className="size-4" /></PopoverTrigger>
    <PopoverContent data-help-popover="" align="start" sideOffset={8} className="w-[360px] max-w-[calc(100vw-2rem)] gap-2 rounded-xl">
      {open && <><div className="flex items-center justify-between gap-2"><PopoverTitle className="text-sm">{title}</PopoverTitle><Button type="button" variant="ghost" size="icon" className="size-10 shrink-0 text-muted-foreground" aria-label="Cerrar ayuda" onClick={() => changeOpen(false)}><X aria-hidden="true" className="size-4" /></Button></div><PopoverDescription className="text-[13px] leading-relaxed text-popover-foreground">{description}</PopoverDescription>{footer && <p className="mt-1 border-t pt-3 text-xs leading-relaxed text-muted-foreground">{footer}</p>}</>}
    </PopoverContent>
  </Popover>;
}
export function CompetencyHelp({ competencyId }: { competencyId: Competency["competency_id"] }) {
  const copy = competencyCopy[competencyId];
  return <InfoPopover title={copy.name} description={copy.description} footer={competencyFooter} accessibleName={`¿Qué es ${copy.name}?`} />;
}
export function ProfileFieldHelp({ field }: { field: keyof typeof profileFieldHelp }) {
  return <InfoPopover title={field} description={profileFieldHelp[field]} accessibleName={`Ayuda: ${field}`} />;
}
