"use client";

import { Fragment, useContext, useMemo, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";
import { Award, BookOpen, Briefcase, ChartNoAxesColumn, Compass, FileUser, Gift, HelpCircle, Images, LayoutGrid, LayoutTemplate, MapPin, MessageSquareQuote, SlidersHorizontal, Users, Video } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Separator } from "@/components/ui/separator";
import { SectionEmpty, StateCard } from "@/components/feedback/state-card";
import { deriveDraftDescriptionPlain } from "@/features/jobs/drafts/rich/plain";
import type { PublicJobItem } from "@/features/jobs/types";
import { cn } from "@/lib/utils";
import { BLOCK_LIBRARY_V2 } from "../defaults";
import { DEFAULT_SECTION_STYLE, HERO_BUTTON_DEFAULTS, type SiteBlock, type SiteBlockV2 } from "../model";
import { siteBrandTokens, siteTintTokens } from "./theme-tokens";
import { editorial, modern } from "./fonts";
import { SiteNavigation } from "./site-navigation";
import { ShareMenu } from "@/features/jobs/components/share-menu";
import { SiteBlockContent, SocialLinks } from "./site-blocks";
import type { CompanySitePresentationProps } from "./presentation-types";
import { SitePortalContext } from "./site-portal";
import { SiteAreaFilterContext, type SiteAreaFilter } from "./site-area-filter";
import { deriveSiteAreas } from "./site-areas";
import { scrimColor, sectionAlign, sectionInnerClass, sectionSurface } from "./section-style";
import { SectionAlignContext, SiteEditingContext } from "./site-heading";
import { mediaUrl } from "./media";
import { EditorPlaceholderContext, hasDraftContent } from "./editor-placeholder";
import { usePrefersReducedMotion } from "./use-reduced-motion";
import styles from "./site-theme.module.css";
import editorStyles from "./editor-affordances.module.css";

const anchor = (block: SiteBlock | SiteBlockV2) => `bloque-${block.id}`;
const blockIcons = { hero: LayoutTemplate, story: BookOpen, values: Compass, benefits: Gift, stats: ChartNoAxesColumn, process: SlidersHorizontal, gallery: Images, testimonials: MessageSquareQuote, video: Video, offices: MapPin, jobs: Briefcase, faq: HelpCircle, closing: LayoutTemplate, team: Users, logos: Award, areas: LayoutGrid, talent_cta: FileUser };
const blankDescriptions: Partial<Record<SiteBlockV2["type"], string>> = {
  story: "Cuenta cómo empezó tu empresa y qué la mueve.",
  areas: "Las áreas salen de tus vacantes publicadas que tienen un área profesional.",
};
/** Only for a section with nothing typed yet (anything typed renders as on the page, see
 * ItemsSlot). Named by the section type, never by what the person wrote. */
function BlankSection({ block, onComplete }: { block: SiteBlockV2; onComplete?: () => void }) {
  const title = block.type === "story" ? "Nuestra historia" : BLOCK_LIBRARY_V2[block.type].label;
  const description = blankDescriptions[block.type] ?? BLOCK_LIBRARY_V2[block.type].description;
  return <div data-editor-placeholder="blank"><SectionEmpty icon={blockIcons[block.type]} tone="info" title={<span id={`${anchor(block)}-title`}>{title} todavía no tiene contenido</span>} description={`${description} Completa esta sección para verla en tu sitio.`} primaryAction={onComplete ? { label: "Completar sección", onClick: onComplete } : undefined} /></div>;
}
/** Preview clicks select their section. Buttons (carousel arrows, FAQ, pause, area cards) keep
 * working and select it too; the editor's own «Completar sección» acts alone. Links never
 * navigate (the preview frame holds them). */
function selectOnClick(event: React.MouseEvent, select: () => void) {
  const control = (event.target as Element | null)?.closest?.("button");
  if (control && event.currentTarget.contains(control)) {
    if (!control.closest("[data-editor-placeholder]")) select();
    return;
  }
  event.preventDefault(); event.stopPropagation(); select();
}
/** Legacy (v1) blocks render exactly like their v2 read: default style and hero buttons. */
export function toSiteBlockV2(block: SiteBlock | SiteBlockV2): SiteBlockV2 {
  if ("style" in block) return block;
  if (block.type === "hero") return { ...block, style: { ...DEFAULT_SECTION_STYLE }, content: { images: [], ...HERO_BUTTON_DEFAULTS, ...block.content } };
  if (block.type === "testimonials") return { ...block, style: { ...DEFAULT_SECTION_STYLE }, content: { ...block.content, items: block.content.items.map(item => ({ video_url: null, ...item })) } };
  return { ...block, style: { ...DEFAULT_SECTION_STYLE } } as SiteBlockV2;
}
/** Draft preview and public read share honest omission; no invented content. Areas
 * derive from the published vacancies, so they need `jobs`. */
export function hasSiteBlockContent(input: SiteBlock | SiteBlockV2, jobs: readonly PublicJobItem[] = []): boolean {
  const block = toSiteBlockV2(input);
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
    case "team": return block.content.items.some(item => item.consent && item.name);
    case "logos": return block.content.items.some(item => item.name && item.image);
    case "areas": return deriveSiteAreas(jobs).length > 0;
    case "talent_cta": return Boolean(block.content.title);
    default: return block.content.items.some(item => item.title);
  }
}

/** Where a section dragged in the editor's list would land (`toIndex` is its
 * final index in `site.blocks`). Editor-only, like every affordance below. */
type DragPreview = { activeId: string; toIndex: number; allowed: boolean } | null;
/** Id of the visible section the dragged one would land before ("" = after the
 * last), counted without the dragged section's own slot; null draws nothing. */
function dropBefore(all: readonly { id: string }[], visible: readonly { id: string }[], drag: DragPreview): string | null {
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

/** The section being dragged keeps its full text contrast: a dashed editor-accent
 * frame (counter-scaled like the selection outline) and a softer saturation mark
 * it, never a lower opacity. */
const dragMark = "motion-safe:transition-[filter] motion-safe:duration-150 data-editor-dragging:saturate-50 data-editor-dragging:after:pointer-events-none data-editor-dragging:after:absolute data-editor-dragging:after:inset-0 data-editor-dragging:after:z-10 data-editor-dragging:after:border-dashed data-editor-dragging:after:border-(--editor-primary) data-editor-dragging:after:border-[length:calc(2px*var(--editor-inverse-scale,1))]";

/** The hero's secondary button target among the rendered sections: its saved target or,
 * when null, the Historia section exactly as before sections v2 (published sites keep
 * their button). Hidden when turned off or when the target is not on the page. */
export function heroSecondaryHref(hero: Extract<SiteBlockV2, { type: "hero" }>, rendered: readonly SiteBlockV2[]): string | undefined {
  if (!hero.content.secondary_visible) return undefined;
  const target = hero.content.secondary_target;
  const block = rendered.find(candidate => target === null ? candidate.type === "story" : candidate.id === target);
  return block ? `#${anchor(block)}` : undefined;
}

/** No reads, server imports or alternate rendering tree: the editor uses this exact page.
 * Editor affordances are opt-in; without onSelectBlock public markup is unchanged. */
export function CompanySitePresentation({ site, company, jobs, jobsAvailable = true, officeLabels, selectedBlockId, onSelectBlock, onCompleteBlock, dragPreview = null }: CompanySitePresentationProps & { dragPreview?: DragPreview }) {
  const previewContainer = useContext(SitePortalContext);
  const [portalRoot, setPortalRoot] = useState<HTMLDivElement | null>(null);
  const [previewRoot, setPreviewRoot] = useState<HTMLDivElement | null>(null);
  const reduced = usePrefersReducedMotion();
  const [areas, setAreas] = useState<string[]>([]);
  const all = useMemo(() => site.blocks.map(toSiteBlockV2), [site.blocks]);
  const blocks = all.filter(block => !block.hidden && (onSelectBlock || hasSiteBlockContent(block, jobs)));
  const style = siteBrandTokens(site.theme.brand_color, site.theme.accent_color, site.theme.background_color) as CSSProperties;
  // Only tinted sections carry the tint tokens, so pages without one keep their exact markup.
  const tinted = all.some(block => block.style.background === "tint");
  const tintStyle = useMemo(() => tinted ? siteTintTokens(site.theme.brand_color, site.theme.accent_color, site.theme.background_color) as CSSProperties : undefined, [tinted, site.theme.brand_color, site.theme.accent_color, site.theme.background_color]);
  const jobsBlock = blocks.find(block => block.type === "jobs");
  const jobsHref = jobsBlock ? `#${anchor(jobsBlock)}` : undefined;
  const areaFilter: SiteAreaFilter = {
    areas, setAreas,
    chips: blocks.some(block => block.type === "areas" && hasSiteBlockContent(block, jobs)),
    showArea: area => {
      if (areas.length === 1 && areas[0] === area) return setAreas([]);
      setAreas([area]);
      if (jobsBlock) document.getElementById(anchor(jobsBlock))?.scrollIntoView?.({ behavior: reduced ? "auto" : "smooth", block: "start" });
    },
  };
  const drop = onSelectBlock ? dropBefore(site.blocks, blocks, dragPreview) : null;
  const dragging = onSelectBlock && dragPreview ? dragPreview.activeId : null;
  const themeProps = {
    "data-font-pair": site.theme.font_pair,
    "data-site-palette": Boolean(site.theme.accent_color || site.theme.background_color),
    style,
    className: cn(styles.site, editorial.variable, modern.variable, "min-w-0 bg-background text-foreground [overflow-wrap:anywhere]"),
  };
  return <SitePortalContext value={previewContainer === undefined ? portalRoot : previewRoot}><SiteEditingContext value={Boolean(onSelectBlock)}><SiteAreaFilterContext value={areaFilter}><div ref={setPortalRoot} {...themeProps}>
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
    {blocks.map(block => {
      const surface = sectionSurface(block);
      const image = block.style.background === "image" ? block.style.image : null;
      return <Fragment key={block.id}>{drop === block.id && <DropLine id={dragPreview!.activeId} />}<section id={anchor(block)} aria-labelledby={`${anchor(block)}-title`} data-block-type={block.type} data-variant={block.variant}
      {...(surface === "brand" || surface === "scrim" || surface === "tint" ? { "data-site-surface": surface } : {})}
      {...(surface === "tint" ? { style: tintStyle } : {})}
      {...(onSelectBlock ? {
        tabIndex: 0, "data-editor-selected": selectedBlockId === block.id, ...(dragging === block.id ? { "data-editor-dragging": true } : {}),
        onClickCapture: (event: React.MouseEvent) => selectOnClick(event, () => onSelectBlock(block.id)),
        onKeyDown: (event: React.KeyboardEvent) => { if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); onSelectBlock(block.id); } },
      } : {})}
      className={cn("scroll-mt-6", surface === "band" && "bg-(--site-band)", surface === "scrim" && "relative isolate", onSelectBlock && editorStyles.section, onSelectBlock && dragMark)}>
      {surface === "scrim" && <div data-section-background="" aria-hidden="true" className="absolute inset-0 -z-10 overflow-hidden">
        {/* eslint-disable-next-line @next/next/no-img-element -- Same-origin capability media proxy. */}
        {image && <img src={mediaUrl(image.media_id)} alt="" loading="lazy" className="size-full object-cover" />}
        <div data-scrim="" className="absolute inset-0" style={{ backgroundColor: scrimColor(block.style.overlay) }} />
      </div>}
      {onSelectBlock && selectedBlockId === block.id && <Badge data-editor-label="" className={editorStyles.label}>{BLOCK_LIBRARY_V2[block.type].label}</Badge>}
      <SectionAlignContext value={sectionAlign(block)}><EditorPlaceholderContext value={onSelectBlock ? { block, icon: blockIcons[block.type], onComplete: () => (onCompleteBlock ?? onSelectBlock)(block.id) } : null}><div className={sectionInnerClass(block.style.spacing)}>{!hasSiteBlockContent(block, jobs) && !(onSelectBlock && hasDraftContent(block)) ? <BlankSection block={block} onComplete={onSelectBlock ? () => (onCompleteBlock ?? onSelectBlock)(block.id) : undefined} /> : block.type === "jobs" && !jobsAvailable ? <StateCard icon={Briefcase} tone="error" title={<span id={`${anchor(block)}-title`}>No pudimos cargar las vacantes</span>} description="La vista previa de las vacantes no está disponible. El contenido del sitio no cambió." /> : <SiteBlockContent block={block} company={company} jobs={jobs} offices={officeLabels} jobsHref={jobsHref} secondaryHref={block.type === "hero" ? heroSecondaryHref(block, blocks) : undefined} />}</div></EditorPlaceholderContext></SectionAlignContext>
    </section></Fragment>;
    })}
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
  </SiteAreaFilterContext></SiteEditingContext></SitePortalContext>;
}
