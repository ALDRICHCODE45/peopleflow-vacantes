"use client";
import { ArrowDown, ChevronDown, Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { BLOCK_LIBRARY } from "../defaults";
import type { SiteBlock } from "../model";

export type SiteAnchor = { id: string; label: string };
/** One model feeds desktop, overflow and mobile; never advertise hidden sections. */
export function visitorAnchors(blocks: SiteBlock[], companyName: string) {
  const visible = blocks.filter(block => !block.hidden);
  const candidates = visible.filter(block => !["hero", "closing", "jobs"].includes(block.type));
  const story = candidates.find(block => block.type === "story");
  const culture = candidates.find(block => block.type === "gallery") ?? candidates.find(block => block.type === "testimonials");
  const benefits = candidates.find(block => block.type === "benefits");
  const preferred: SiteBlock[] = [story, culture, benefits].filter(block => block !== undefined);
  const ordered = [...preferred, ...candidates.filter(block => !preferred.includes(block))];
  const anchors = ordered.map(block => ({ id: `bloque-${block.id}`, label: block === story ? "Nosotros" : block === culture ? `La vida en ${companyName}` : BLOCK_LIBRARY[block.type].label }));
  const jobs = visible.find(block => block.type === "jobs");
  return { primary: anchors.slice(0, 3), remaining: anchors.slice(3), all: anchors, jobs: jobs ? { id: `bloque-${jobs.id}`, label: "Ver vacantes" } : null };
}
function AnchorMenu({ anchors, mobile = false }: { anchors: SiteAnchor[]; mobile?: boolean }) {
  return <DropdownMenu>
    <DropdownMenuTrigger render={<Button variant={mobile ? "outline" : "ghost"} size={mobile ? "icon" : "default"} className={mobile ? "size-10" : "min-h-10"} aria-label={mobile ? "Abrir navegación de la empresa" : "Más"} />}>
      {mobile ? <Menu aria-hidden="true" /> : <>Más<ChevronDown aria-hidden="true" data-icon="inline-end" /></>}
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end" className="max-w-[calc(100vw-2rem)]"><DropdownMenuGroup>{anchors.map(item => <DropdownMenuItem key={item.id} className="min-h-10" render={<a href={`#${item.id}`} />}>{item.label}</DropdownMenuItem>)}</DropdownMenuGroup></DropdownMenuContent>
  </DropdownMenu>;
}
/** Official menu composition; the root owns only its trigger and popup. */
export function SiteNavigation({ blocks, companyName }: { blocks: SiteBlock[]; companyName: string }) {
  const { primary, remaining, all, jobs } = visitorAnchors(blocks, companyName);
  return <>
    <nav aria-label="Secciones de la empresa" className="hidden min-w-0 items-center justify-end gap-2 xl:flex">
      {primary.map(item => <Button key={item.id} nativeButton={false} role="link" className="min-h-10 max-w-44" variant="ghost" render={<a href={`#${item.id}`} title={item.label} />}><span className="truncate">{item.label}</span></Button>)}
      {remaining.length > 0 && <AnchorMenu anchors={remaining} />}
      {jobs && <Button nativeButton={false} role="link" className="min-h-10" variant="outline" render={<a href={`#${jobs.id}`} />}>Ver vacantes<ArrowDown aria-hidden="true" data-icon="inline-end" /></Button>}
    </nav>
    {(all.length > 0 || jobs) && <div className="xl:hidden"><AnchorMenu mobile anchors={jobs ? [...all, jobs] : all} /></div>}
  </>;
}
