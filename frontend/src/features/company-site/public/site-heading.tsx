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
export function Heading({ block, children }: { block: SiteBlock | SiteBlockV2; children?: ReactNode }) {
  const centered = useSectionAlign() === "center";
  return <div className={cn("flex max-w-prose flex-col gap-4", centered && "mx-auto items-center text-center")}>
    {siteBlockTitle(block) !== BLOCK_LIBRARY_V2[block.type].label && <p className="text-xs font-medium tracking-widest text-(--site-brand-text) uppercase">{BLOCK_LIBRARY_V2[block.type].label}</p>}
    <h2 id={`${siteAnchor(block)}-title`} className="max-w-[24ch] text-3xl leading-tight font-medium tracking-tight text-balance sm:text-4xl lg:text-5xl">{siteBlockTitle(block)}</h2>
    {children}
  </div>;
}
export function JobsLink({ href, onBrand = false, centered = false, label = "Ver vacantes" }: { href?: string; onBrand?: boolean; centered?: boolean; label?: string }) {
  if (!href) return null;
  return <Button nativeButton={false} role="link" data-brand-surface={onBrand ? undefined : ""} data-brand-inverse={onBrand ? "" : undefined} className={cn("min-h-10 w-full sm:w-auto", centered ? "sm:self-center" : "sm:self-start")} render={<a href={href} />}>{label}<ArrowDown aria-hidden="true" data-icon="inline-end" /></Button>;
}
