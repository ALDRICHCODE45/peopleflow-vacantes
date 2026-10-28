"use client";

import { useContext, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";
import { Briefcase } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Separator } from "@/components/ui/separator";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { StateCard } from "@/components/feedback/state-card";
import { deriveDraftDescriptionPlain } from "@/features/jobs/drafts/rich/plain";
import { cn } from "@/lib/utils";
import { BLOCK_LIBRARY } from "../defaults";
import type { SiteBlock } from "../model";
import { siteBrandTokens } from "./theme-tokens";
import { editorial, modern } from "./fonts";
import { SiteNavigation } from "./site-navigation";
import { SiteBlockContent, SocialLinks } from "./site-blocks";
import type { CompanySitePresentationProps } from "./presentation-types";
import { SitePortalContext } from "./site-portal";
import styles from "./site-theme.module.css";
import editorStyles from "./editor-affordances.module.css";

const anchor = (block: SiteBlock) => `bloque-${block.id}`;
/** Draft preview and public read share honest omission; no invented content. */
export function hasSiteBlockContent(block: SiteBlock): boolean {
  switch (block.type) {
    case "hero": case "jobs": return true;
    case "story": return Boolean(deriveDraftDescriptionPlain(block.content.body));
    case "video": return Boolean(block.content.video);
    case "closing": return Boolean(block.content.title);
    case "gallery": return block.content.items.some(item => item.image && item.alt);
    case "testimonials": return block.content.items.some(item => item.consent && item.name && item.quote);
    case "stats": return block.content.items.some(item => item.value && item.label);
    case "offices": return block.content.items.some(item => item.name);
    case "faq": return block.content.items.some(item => item.question && item.answer);
    default: return block.content.items.some(item => item.title);
  }
}

/** No reads, server imports or alternate rendering tree: the editor uses this exact page.
 * Editor affordances are opt-in; without onSelectBlock public markup is unchanged. */
export function CompanySitePresentation({ site, company, jobs, jobsAvailable = true, officeLabels, selectedBlockId, onSelectBlock }: CompanySitePresentationProps) {
  const previewContainer = useContext(SitePortalContext);
  const [portalRoot, setPortalRoot] = useState<HTMLDivElement | null>(null);
  const [previewRoot, setPreviewRoot] = useState<HTMLDivElement | null>(null);
  const blocks = site.blocks.filter(block => !block.hidden && (onSelectBlock || hasSiteBlockContent(block)));
  const style = siteBrandTokens(site.theme.brand_color, site.theme.accent_color, site.theme.background_color) as CSSProperties;
  const jobsBlock = blocks.find(block => block.type === "jobs");
  const storyBlock = blocks.find(block => block.type === "story");
  const themeProps = {
    "data-font-pair": site.theme.font_pair,
    "data-site-palette": Boolean(site.theme.accent_color || site.theme.background_color),
    style,
    className: cn(styles.site, editorial.variable, modern.variable, "min-w-0 bg-background text-foreground [overflow-wrap:anywhere]"),
  };
  return <SitePortalContext value={previewContainer === undefined ? portalRoot : previewRoot}><div ref={setPortalRoot} {...themeProps}>
    <Link href="#contenido" className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:rounded-xl focus:bg-background focus:px-4 focus:py-3 focus:text-foreground focus:outline-2 focus:outline-ring">Saltar al contenido</Link>
    <header className="mx-auto flex max-w-7xl items-center justify-between gap-6 px-6 py-6 sm:px-10 lg:px-16">
      <div className="flex min-w-0 shrink-0 items-center gap-3"><Avatar className="size-10"><AvatarImage src={company.logo_url ?? undefined} alt={`Logo de ${company.name}`} /><AvatarFallback>{company.name.slice(0, 1)}</AvatarFallback></Avatar><p className="max-w-[16ch] text-lg font-semibold tracking-tight [overflow-wrap:anywhere]">{company.name}</p></div>
      <SiteNavigation blocks={blocks} companyName={company.name} />
    </header>
    <main id="contenido" tabIndex={-1} className="min-w-0 outline-none">
    {blocks.map(block => <section key={block.id} id={anchor(block)} aria-labelledby={`${anchor(block)}-title`} data-block-type={block.type} data-variant={block.variant}
      {...(onSelectBlock ? {
        tabIndex: 0, "data-editor-selected": selectedBlockId === block.id,
        onClickCapture: (event: React.MouseEvent) => { event.preventDefault(); event.stopPropagation(); onSelectBlock(block.id); },
        onKeyDown: (event: React.KeyboardEvent) => { if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); onSelectBlock(block.id); } },
      } : {})}
      className={cn("scroll-mt-6", (block.type === "story" || block.type === "jobs" || block.type === "stats" && block.variant === "row" || block.type === "benefits" && block.variant === "grid" || block.type === "video" && block.variant === "split") && "bg-(--site-band)", onSelectBlock && editorStyles.section)}>
      {onSelectBlock && selectedBlockId === block.id && <Badge data-editor-label="" className={editorStyles.label}>{BLOCK_LIBRARY[block.type].label}</Badge>}
      <div className="mx-auto max-w-7xl px-6 py-10 sm:px-10 sm:py-14 lg:px-16 lg:py-16">{!hasSiteBlockContent(block) ? <Empty><EmptyHeader><EmptyTitle><h2 id={`${anchor(block)}-title`}>{BLOCK_LIBRARY[block.type].label}</h2></EmptyTitle><EmptyDescription>Agrega contenido a esta sección para verla en tu sitio.</EmptyDescription></EmptyHeader></Empty> : block.type === "jobs" && !jobsAvailable ? <StateCard icon={Briefcase} tone="error" title={<span id={`${anchor(block)}-title`}>No pudimos cargar las vacantes</span>} description="La vista previa de las vacantes no está disponible. El contenido del sitio no cambió." /> : <SiteBlockContent block={block} company={company} jobs={jobs} offices={officeLabels} jobsHref={jobsBlock ? `#${anchor(jobsBlock)}` : undefined} storyHref={storyBlock ? `#${anchor(storyBlock)}` : undefined} />}</div>
    </section>)}
    </main>
    <Separator />
    <footer className="mx-auto flex max-w-7xl flex-col gap-6 px-6 py-8 sm:px-10 lg:flex-row lg:flex-wrap lg:items-center lg:justify-between lg:px-16">
      <div className="flex flex-col gap-2"><p className="text-lg font-semibold">{company.name}</p>{company.description && <p className="max-w-prose text-sm leading-relaxed text-muted-foreground">{company.description}</p>}</div>
      <SocialLinks company={company} />
      <p className="w-full basis-full text-xs text-muted-foreground">Impulsado por <Link href="/" aria-label="PeopleFlow para empresas" className="inline-flex min-h-10 items-center font-semibold underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-ring">PeopleFlow</Link></p>
    </footer>
  </div>
    {/* The preview viewport is a body sibling, not a descendant of the page.
        Repeat only its theme scope, never the page content or landmarks. */}
    {previewContainer && createPortal(<div ref={setPreviewRoot} {...themeProps} data-site-overlay-root="" className={cn(themeProps.className, "pointer-events-none [&>*]:pointer-events-auto")} />, previewContainer)}
  </SitePortalContext>;
}
