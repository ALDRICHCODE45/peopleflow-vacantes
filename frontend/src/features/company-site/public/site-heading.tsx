"use client";
import { createContext, useContext, type ReactNode } from "react";
import { ArrowDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { BLOCK_LIBRARY_V2 } from "../defaults";
import type { SectionStyle, SiteBlock, SiteBlockV2 } from "../model";

/** The section wrapper's «Alineación» (S3); headings and centred layouts read it. */
export const SectionAlignContext = createContext<SectionStyle["align"]>("start");
export const useSectionAlign = () => useContext(SectionAlignContext);

export const siteAnchor = (block: SiteBlock | SiteBlockV2) => `bloque-${block.id}`;
export function siteBlockTitle(block: SiteBlock | SiteBlockV2): string {
  return ("title" in block.content && block.content.title) || BLOCK_LIBRARY_V2[block.type].label;
}
/** Editor preview (not the public page): placeholders may ask for the missing photo. */
export const SiteEditingContext = createContext(false);
export const useSiteEditing = () => useContext(SiteEditingContext);
/** The eyebrow names the section without its slash alternative («Equipo / Líderes» → «Equipo»). */
export const sectionEyebrow = (block: SiteBlock | SiteBlockV2) => BLOCK_LIBRARY_V2[block.type].label.split(" / ")[0];
/** `display`: the bold display heading of the sections v2 layouts (02/03). Legacy layouts keep
 * their pinned medium weight (legacy markup golden). `title` replaces the derived title. */
export function Heading({ block, children, display = false, title }: { block: SiteBlock | SiteBlockV2; children?: ReactNode; display?: boolean; title?: string }) {
  const centered = useSectionAlign() === "center";
  const text = title ?? siteBlockTitle(block);
  return <div className={cn("flex max-w-prose flex-col gap-4", centered && "mx-auto items-center text-center")}>
    {text !== BLOCK_LIBRARY_V2[block.type].label && <p className={display ? "text-xs font-semibold tracking-widest text-(--site-brand-text) uppercase" : "text-xs font-medium tracking-widest text-(--site-brand-text) uppercase"}>{sectionEyebrow(block)}</p>}
    <h2 id={`${siteAnchor(block)}-title`} className={display ? "max-w-[24ch] text-3xl leading-tight font-semibold tracking-tight text-balance sm:text-4xl lg:text-5xl" : "max-w-[24ch] text-3xl leading-tight font-medium tracking-tight text-balance sm:text-4xl lg:text-5xl"}>{text}</h2>
    {children}
  </div>;
}
export function JobsLink({ href, onBrand = false, centered = false, label = "Ver vacantes" }: { href?: string; onBrand?: boolean; centered?: boolean; label?: string }) {
  if (!href) return null;
  return <Button nativeButton={false} role="link" data-brand-surface={onBrand ? undefined : ""} data-brand-inverse={onBrand ? "" : undefined} className={cn("min-h-10 w-full sm:w-auto", centered ? "sm:self-center" : "sm:self-start")} render={<a href={href} />}>{label}<ArrowDown aria-hidden="true" data-icon="inline-end" /></Button>;
}
