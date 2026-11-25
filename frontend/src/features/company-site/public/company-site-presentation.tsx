"use client";

import { Fragment, useContext, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";
import { BookOpen, Briefcase, ChartNoAxesColumn, Compass, Gift, HelpCircle, Images, LayoutTemplate, MapPin, MessageSquareQuote, SlidersHorizontal, Video } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Separator } from "@/components/ui/separator";
import { SectionEmpty, StateCard } from "@/components/feedback/state-card";
import { deriveDraftDescriptionPlain } from "@/features/jobs/drafts/rich/plain";
import { cn } from "@/lib/utils";
import { BLOCK_LIBRARY } from "../defaults";
import type { SiteBlock } from "../model";
import { siteBrandTokens } from "./theme-tokens";
import { editorial, modern } from "./fonts";
import { SiteNavigation } from "./site-navigation";
import { ShareMenu } from "@/features/jobs/components/share-menu";
import { SiteBlockContent, SocialLinks } from "./site-blocks";
import type { CompanySitePresentationProps } from "./presentation-types";
import { SitePortalContext } from "./site-portal";
import styles from "./site-theme.module.css";
import editorStyles from "./editor-affordances.module.css";

const anchor = (block: SiteBlock) => `bloque-${block.id}`;
const blockIcons = { hero: LayoutTemplate, story: BookOpen, values: Compass, benefits: Gift, stats: ChartNoAxesColumn, process: SlidersHorizontal, gallery: Images, testimonials: MessageSquareQuote, video: Video, offices: MapPin, jobs: Briefcase, faq: HelpCircle, closing: LayoutTemplate };
function BlankSection({ block, onSelect }: { block: SiteBlock; onSelect?: (id: string) => void }) {
  const title = ("title" in block.content && block.content.title) || (block.type === "story" ? "Nuestra historia" : BLOCK_LIBRARY[block.type].label);
  const description = block.type === "story" ? "Cuenta cómo empezó tu empresa y qué la mueve." : BLOCK_LIBRARY[block.type].description;
  return <SectionEmpty icon={blockIcons[block.type]} tone="info" title={<span id={`${anchor(block)}-title`}>{title} todavía no tiene contenido</span>} description={`${description} Completa esta sección para verla en tu sitio.`} primaryAction={onSelect ? { label: "Completar sección", onClick: () => onSelect(block.id) } : undefined} />;
}
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

/** Where a section dragged in the editor's list would land (`toIndex` is its
 * final index in `site.blocks`). Editor-only, like every affordance below. */
type DragPreview = { activeId: string; toIndex: number; allowed: boolean } | null;
/** Id of the visible section the dragged one would land before ("" = after the
 * last), counted without the dragged section's own slot; null draws nothing. */
function dropBefore(all: readonly SiteBlock[], visible: readonly SiteBlock[], drag: DragPreview): string | null {
  const from = drag ? all.findIndex(block => block.id === drag.activeId) : -1;
  if (!drag || !drag.allowed || from < 0 || from === drag.toIndex) return null;
  const rest = all.filter(block => block.id !== drag.activeId);
  const shown = new Set(visible.map(block => block.id));
  return rest.slice(drag.toIndex).find(block => shown.has(block.id))?.id ?? "";
}
/** A calm 3 px editor-accent rule with a small label, laid over the gap without
 * changing the page's height; counter-scaled like the selection outline. */
function DropLine({ id }: { id: string }) {
  return <div data-editor-drop-line={id} aria-hidden="true" className="pointer-events-none relative z-10 h-0">
    <div className="absolute inset-x-0 top-[calc(-1.5px*var(--editor-inverse-scale,1))] h-[calc(3px*var(--editor-inverse-scale,1))] rounded-full bg-(--editor-primary) motion-safe:animate-in motion-safe:fade-in-0 motion-safe:duration-150" />
    <span className="absolute top-0 left-1/2 origin-center -translate-x-1/2 -translate-y-1/2 [scale:var(--editor-inverse-scale,1)] rounded-full bg-(--editor-primary) px-2.5 py-0.5 font-sans text-xs font-medium text-(--editor-primary-foreground) shadow-sm">Soltar aquí</span>
  </div>;
}

/** No reads, server imports or alternate rendering tree: the editor uses this exact page.
 * Editor affordances are opt-in; without onSelectBlock public markup is unchanged. */
export function CompanySitePresentation({ site, company, jobs, jobsAvailable = true, officeLabels, selectedBlockId, onSelectBlock, dragPreview = null }: CompanySitePresentationProps & { dragPreview?: DragPreview }) {
  const previewContainer = useContext(SitePortalContext);
  const [portalRoot, setPortalRoot] = useState<HTMLDivElement | null>(null);
  const [previewRoot, setPreviewRoot] = useState<HTMLDivElement | null>(null);
  const blocks = site.blocks.filter(block => !block.hidden && (onSelectBlock || hasSiteBlockContent(block)));
  const style = siteBrandTokens(site.theme.brand_color, site.theme.accent_color, site.theme.background_color) as CSSProperties;
  const jobsBlock = blocks.find(block => block.type === "jobs");
  const storyBlock = blocks.find(block => block.type === "story");
  const drop = onSelectBlock ? dropBefore(site.blocks, blocks, dragPreview) : null;
  const dragging = onSelectBlock && dragPreview ? dragPreview.activeId : null;
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
      <div className="flex min-w-0 items-center justify-end gap-2">
        <SiteNavigation blocks={blocks} companyName={company.name} />
        {/* Only the live page is shareable: the editor preview has no public URL. */}
        {!onSelectBlock && previewContainer === undefined && <ShareMenu title={`Trabaja en ${company.name}`} intro="Conoce esta empresa" label="Compartir sitio de empleo" iconOnly />}
      </div>
    </header>
    <main id="contenido" tabIndex={-1} className="min-w-0 outline-none">
    {blocks.map(block => <Fragment key={block.id}>{drop === block.id && <DropLine id={dragPreview!.activeId} />}<section id={anchor(block)} aria-labelledby={`${anchor(block)}-title`} data-block-type={block.type} data-variant={block.variant}
      {...(onSelectBlock ? {
        tabIndex: 0, "data-editor-selected": selectedBlockId === block.id, ...(dragging === block.id ? { "data-editor-dragging": true } : {}),
        onClickCapture: (event: React.MouseEvent) => { event.preventDefault(); event.stopPropagation(); onSelectBlock(block.id); },
        onKeyDown: (event: React.KeyboardEvent) => { if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); onSelectBlock(block.id); } },
      } : {})}
      className={cn("scroll-mt-6", (block.type === "story" || block.type === "jobs" || block.type === "stats" && block.variant === "row" || block.type === "benefits" && block.variant === "grid" || block.type === "video" && block.variant === "split") && "bg-(--site-band)", onSelectBlock && editorStyles.section, onSelectBlock && "motion-safe:transition-opacity motion-safe:duration-150 data-editor-dragging:opacity-40")}>
      {onSelectBlock && selectedBlockId === block.id && <Badge data-editor-label="" className={editorStyles.label}>{BLOCK_LIBRARY[block.type].label}</Badge>}
      <div className="mx-auto max-w-7xl px-6 py-10 sm:px-10 sm:py-14 lg:px-16 lg:py-16">{!hasSiteBlockContent(block) ? <BlankSection block={block} onSelect={onSelectBlock} /> : block.type === "jobs" && !jobsAvailable ? <StateCard icon={Briefcase} tone="error" title={<span id={`${anchor(block)}-title`}>No pudimos cargar las vacantes</span>} description="La vista previa de las vacantes no está disponible. El contenido del sitio no cambió." /> : <SiteBlockContent block={block} company={company} jobs={jobs} offices={officeLabels} jobsHref={jobsBlock ? `#${anchor(jobsBlock)}` : undefined} storyHref={storyBlock ? `#${anchor(storyBlock)}` : undefined} />}</div>
    </section></Fragment>)}
    {drop === "" && <DropLine id={dragPreview!.activeId} />}
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
