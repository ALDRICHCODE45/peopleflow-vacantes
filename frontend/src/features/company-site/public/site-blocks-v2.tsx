/* eslint-disable @next/next/no-img-element -- Same-origin capability media proxy. */
"use client";
import { useId, useState, type ReactNode } from "react";
import Link from "next/link";
import { ArrowDown, ArrowUpRight, Briefcase, ChevronLeft, ChevronRight, FileUser, MapPin, Pause, Play, Quote } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { careersSiteVacancyHref } from "@/features/jobs/application/application-draft";
import { publicJobConditions } from "@/features/jobs/components/public-job-facts";
import type { PublicJobItem } from "@/features/jobs/types";
import { HERO_BUTTON_DEFAULTS, type SiteBlockV2 } from "../model";
import { parseVideoUrl } from "../video";
import type { PublicSite } from "./schema";
import { bentoCellClass, bentoLayout } from "./bento";
import { CountUp } from "./count-up";
import { mediaUrl } from "./media";
import { AREA_PHOTO_SCRIM, scrimColor } from "./section-style";
import { useSiteAreaFilter } from "./site-area-filter";
import { DEFAULT_AREA_ICONS, deriveSiteAreas } from "./site-areas";
import { Heading, JobsLink, siteAnchor, useSectionAlign } from "./site-heading";
import { SITE_ICONS } from "./site-icons";
import { SiteMedia } from "./site-media";
import { usePrefersReducedMotion } from "./use-reduced-motion";
import { VideoFrame } from "./video-player";
import styles from "./site-theme.module.css";

type Of<T extends SiteBlockV2["type"]> = Extract<SiteBlockV2, { type: T }>;
type Company = PublicSite["company"];
const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;
const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map(word => [...word][0]).join("").toLocaleUpperCase("es");

/** Newest public vacancies first («Vacantes recientes»). */
export function newestJobs(jobs: readonly PublicJobItem[], count: number): PublicJobItem[] {
  return [...jobs].sort((a, b) => Date.parse(b.published_at) - Date.parse(a.published_at)).slice(0, count);
}

// ---------------------------------------------------------------------------
// Portada
// ---------------------------------------------------------------------------

type HeroProps = { block: Of<"hero">; company: Company; jobs: PublicJobItem[]; jobsHref?: string; secondaryHref?: string };
function HeroTitle({ block, className }: { block: Of<"hero">; className?: string }) {
  return <h1 id={`${siteAnchor(block)}-title`} className={cn("text-4xl leading-[1.08] font-semibold tracking-tight text-balance whitespace-pre-line sm:text-6xl lg:text-7xl", className)}>{block.content.title}</h1>;
}
/** Both hero buttons: the primary always leads to the vacancies; the secondary to its target section. */
export function HeroActions({ block, jobsHref, secondaryHref, centered = false, dark = false }: { block: Of<"hero">; jobsHref?: string; secondaryHref?: string; centered?: boolean; dark?: boolean }) {
  return <div className={cn("flex w-full flex-col gap-3 sm:w-auto sm:flex-row", centered ? "items-center sm:justify-center" : "items-stretch sm:items-center")}>
    <JobsLink href={jobsHref} label={block.content.primary_label ?? HERO_BUTTON_DEFAULTS.primary_label} centered={centered} />
    {secondaryHref && <Button nativeButton={false} role="link" variant={dark ? "outline" : "ghost"} className={cn("min-h-10 w-full sm:w-auto", dark && "bg-transparent")} render={<a href={secondaryHref} />}>{block.content.secondary_label ?? HERO_BUTTON_DEFAULTS.secondary_label}<ArrowDown aria-hidden="true" data-icon="inline-end" /></Button>}
  </div>;
}
/** A dark rounded panel: photo or brand gradient under the contrast scrim, white copy. */
function DarkPanel({ marker, media, className, children }: { marker: string; media: ReactNode; className?: string; children: ReactNode }) {
  return <div data-layout={marker} data-site-surface="scrim" className={cn("relative isolate overflow-hidden rounded-3xl", className)}>
    <div aria-hidden="true" className="absolute inset-0 -z-10">{media}<div data-scrim="" className="absolute inset-0" style={{ backgroundColor: scrimColor("soft") }} /></div>
    {children}
  </div>;
}
const panelPhoto = (image: { media_id: string }) => <SiteMedia eager image={image} alt="" className="size-full rounded-none" />;

/** «Fondo en movimiento» (02). Until the background video ships (slice B) the poster
 * (cover) or an animated brand gradient stands in; there is never a broken <video>. */
function HeroLoop({ block, company, jobs, jobsHref, secondaryHref }: HeroProps) {
  const reduced = usePrefersReducedMotion();
  const [paused, setPaused] = useState(false);
  const centered = useSectionAlign() === "center";
  const cover = block.content.cover;
  const chips = [
    company.location?.label ? { key: "location", Icon: MapPin, text: company.location.label } : null,
    jobs.length ? { key: "jobs", Icon: Briefcase, text: plural(jobs.length, "vacante abierta", "vacantes abiertas") } : null,
  ].filter(chip => chip !== null);
  const animated = !cover && !reduced;
  return <DarkPanel marker="hero-background_loop" className="flex min-h-[30rem] flex-col justify-between gap-10 px-6 py-10 sm:px-12 sm:py-14 lg:min-h-[36rem]"
    media={cover ? panelPhoto(cover) : <div data-hero-loop="" data-paused={String(paused || reduced)} className={cn("absolute inset-0", styles.heroGradient, styles.heroLoop)} />}>
    <div className={cn("my-auto flex flex-col gap-6", centered ? "mx-auto max-w-3xl items-center text-center" : "max-w-3xl")}>
      <p className="w-fit rounded-full border border-border px-4 py-1.5 text-xs font-medium tracking-widest uppercase">{company.name} · Tu próximo capítulo</p>
      <HeroTitle block={block} />
      {block.content.subtitle && <p className="max-w-[48ch] text-base leading-relaxed text-pretty sm:text-lg">{block.content.subtitle}</p>}
      <HeroActions block={block} jobsHref={jobsHref} secondaryHref={secondaryHref} centered={centered} dark />
    </div>
    {(chips.length > 0 || animated) && <div className="flex flex-wrap items-end justify-between gap-3">
      {chips.length > 0 && <ul aria-label={`Datos de ${company.name}`} className="flex flex-wrap gap-2">{chips.map(({ key, Icon, text }) => <li key={key} className="inline-flex min-h-8 items-center gap-2 rounded-full bg-(--card) px-3 text-sm"><Icon aria-hidden="true" className="size-4 shrink-0" />{text}</li>)}</ul>}
      {animated && <Button type="button" variant="outline" className="ms-auto min-h-10 bg-transparent" onClick={() => setPaused(value => !value)}>{paused ? <Play aria-hidden="true" data-icon="inline-start" /> : <Pause aria-hidden="true" data-icon="inline-start" />}{paused ? "Reanudar fondo animado" : "Pausar fondo animado"}</Button>}
    </div>}
  </DarkPanel>;
}

/** «Foto con vacantes recientes» (03): photo background and the newest vacancies. */
function HeroPhotoJobs({ block, company, jobs, jobsHref, secondaryHref }: HeroProps) {
  const titleId = useId();
  const recent = newestJobs(jobs, 3);
  const cover = block.content.cover;
  return <DarkPanel marker="hero-photo_jobs" className="grid items-end gap-8 px-6 py-10 sm:px-12 sm:py-14 lg:min-h-[36rem] lg:grid-cols-[minmax(0,1fr)_22rem]"
    media={cover ? panelPhoto(cover) : <div className={cn("absolute inset-0", styles.heroGradient)} />}>
    <div className="flex max-w-3xl flex-col gap-6">
      <p className="text-xs font-medium tracking-widest uppercase">{company.name} · Tu próximo capítulo</p>
      <HeroTitle block={block} />
      {block.content.subtitle && <p className="max-w-[48ch] text-base leading-relaxed text-pretty sm:text-lg">{block.content.subtitle}</p>}
      <HeroActions block={block} jobsHref={jobsHref} secondaryHref={secondaryHref} dark />
    </div>
    {recent.length > 0 && <Card role="region" aria-labelledby={titleId} className="min-w-0 backdrop-blur-sm">
      <CardHeader><CardTitle><h2 id={titleId} className="flex items-center gap-2 text-base font-semibold"><span aria-hidden="true" className="size-2 rounded-full bg-(--site-accent)" />Vacantes recientes</h2></CardTitle></CardHeader>
      <CardContent><ul className="-mx-2 flex flex-col gap-1">{recent.map(job => <li key={job.id}>
        <Link href={careersSiteVacancyHref(job.id)} className="flex items-start justify-between gap-3 rounded-2xl p-2 outline-none hover:bg-(--muted) focus-visible:ring-2 focus-visible:ring-ring">
          <span className="flex min-w-0 flex-col gap-1"><span className="font-medium">{job.title}</span><span className="text-sm text-muted-foreground">{publicJobConditions(job).filter(fact => fact.key === "location" || fact.key === "work_mode").map(fact => fact.value).join(" · ")}</span></span>
          <ArrowUpRight aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
        </Link>
      </li>)}</ul></CardContent>
      {jobsHref && <CardFooter className="justify-center"><Button nativeButton={false} role="link" variant="link" className="min-h-10" render={<a href={jobsHref} />}>{jobs.length === 1 ? "Ver la vacante" : `Ver las ${jobs.length} vacantes`}</Button></CardFooter>}
    </Card>}
  </DarkPanel>;
}

/** «Collage de fotos»: copy beside up to three photos (the cover when none were picked). */
function HeroCollage({ block, company, jobsHref, secondaryHref }: HeroProps) {
  const photos = (block.content.images.length ? block.content.images : block.content.cover ? [block.content.cover] : []).slice(0, 3);
  return <div data-layout="hero-collage" className={cn("grid items-center gap-8 sm:gap-12", photos.length > 0 && "lg:grid-cols-2")}>
    <div className="flex flex-col gap-6">
      <p className="text-xs font-medium tracking-widest text-(--site-brand-text) uppercase">{company.name} · Tu próximo capítulo</p>
      <HeroTitle block={block} className="font-medium sm:text-5xl lg:text-6xl" />
      {block.content.subtitle && <p className="max-w-[48ch] text-base leading-relaxed text-pretty text-muted-foreground sm:text-lg">{block.content.subtitle}</p>}
      <HeroActions block={block} jobsHref={jobsHref} secondaryHref={secondaryHref} />
    </div>
    {photos.length > 0 && <div className={cn("grid min-w-0 gap-4", photos.length > 1 && "grid-cols-2", photos.length === 3 && "grid-rows-2")}>
      {photos.map((photo, index) => <SiteMedia key={index} eager={index === 0} image={photo} alt={`Foto ${index + 1} del equipo de ${company.name}`} className={cn("rounded-3xl",
        photos.length === 1 && "aspect-4/3",
        photos.length === 2 && cn("aspect-3/4", index === 1 && "mt-12"),
        photos.length === 3 && (index === 0 ? "row-span-2 h-full" : "aspect-4/3"))} />)}
    </div>}
  </div>;
}

export function HeroV2(props: HeroProps) {
  if (props.block.variant === "photo_jobs") return <HeroPhotoJobs {...props} />;
  if (props.block.variant === "collage") return <HeroCollage {...props} />;
  return <HeroLoop {...props} />;
}

// ---------------------------------------------------------------------------
// Beneficios / Misión y valores
// ---------------------------------------------------------------------------

type Decorated = Of<"values"> | Of<"benefits">;
type DecoratedItem = Decorated["content"]["items"][number];
function Decoration({ item, className }: { item: DecoratedItem; className: string }) {
  const Icon = item.icon ? SITE_ICONS[item.icon] : null;
  return <span aria-hidden="true" className={cn("inline-flex shrink-0 items-center justify-center rounded-2xl", className)}>
    {item.emoji ? <span data-site-emoji="" className="text-[1.75rem] leading-none">{item.emoji}</span> : Icon && <Icon data-site-icon={item.icon!} className="size-1/2" />}
  </span>;
}
const Mission = ({ block }: { block: Decorated }) => block.type === "values" && block.content.mission ? <p className="text-base leading-relaxed text-muted-foreground sm:text-lg">{block.content.mission}</p> : null;

/** Bento mosaic (02): the item count picks the layout, so no row is left half empty. */
export function DecoratedBento({ block }: { block: Decorated }) {
  const items = block.content.items.filter(item => item.title);
  const cells = bentoLayout(items.length);
  return <div data-layout={`${block.type}-bento`} className="flex flex-col gap-8">
    <Heading block={block}><Mission block={block} /></Heading>
    <ul data-bento-count={items.length} className="grid gap-4 sm:grid-cols-2 lg:grid-flow-row-dense lg:grid-cols-6">
      {items.map((item, index) => {
        const lead = index === 0 && cells[0].row === 2;
        return <li key={index} className={cn("min-w-0", bentoCellClass(cells[index]))}>
          <Card className={cn("h-full", lead && "justify-end bg-(--site-band)")}>
            <CardHeader className="gap-3">
              <Decoration item={item} className={cn("mb-2 text-(--site-brand-text)", lead ? "size-16 bg-(--card)" : "size-12 bg-(--site-band)")} />
              <CardTitle><h3 className={cn("text-lg", lead && "text-2xl sm:text-3xl")}>{item.title}</h3></CardTitle>
            </CardHeader>
            {item.description && <CardContent><p className="leading-relaxed text-muted-foreground">{item.description}</p></CardContent>}
          </Card>
        </li>;
      })}
    </ul>
  </div>;
}

/** «Íconos grandes» (02): one card per item with a large accent icon. */
export function BigIcons({ block }: { block: Decorated }) {
  const centered = useSectionAlign() === "center";
  const items = block.content.items.filter(item => item.title);
  return <div data-layout={`${block.type}-big_icons`} className="flex flex-col gap-10">
    <Heading block={block}><Mission block={block} /></Heading>
    <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">{items.map((item, index) => <li key={index} className="min-w-0">
      <Card className={cn("h-full", centered && "text-center")}>
        <CardHeader className={cn("gap-3", centered && "justify-items-center")}>
          <Decoration item={item} className="mb-3 size-14 bg-primary text-primary-foreground" />
          <CardTitle><h3 className="text-xl">{item.title}</h3></CardTitle>
        </CardHeader>
        {item.description && <CardContent><p className="leading-relaxed text-muted-foreground">{item.description}</p></CardContent>}
      </Card>
    </li>)}</ul>
  </div>;
}

// ---------------------------------------------------------------------------
// Cifras
// ---------------------------------------------------------------------------

/** «Banda de marca»: big figures on the brand band, counting up once on screen. */
export function StatsBand({ block }: { block: Of<"stats"> }) {
  const centered = useSectionAlign() === "center";
  const items = block.content.items.filter(item => item.value && item.label);
  return <div data-layout="stats-brand_band" className="flex flex-col gap-10">
    <Heading block={block} />
    <dl className={cn("grid grid-cols-[repeat(auto-fit,minmax(min(100%,12rem),1fr))] gap-x-8 gap-y-10", centered && "text-center")}>
      {items.map((item, index) => <div key={index} className="flex min-w-0 flex-col gap-3">
        <dt className="order-last text-base leading-snug">{item.label}</dt>
        <dd className={cn("leading-none font-semibold tracking-tight tabular-nums [overflow-wrap:normal] [word-break:normal]", [...item.value!].length > 10 ? "text-2xl" : [...item.value!].length > 6 ? "text-4xl" : "text-5xl sm:text-6xl")}><CountUp value={item.value!} /></dd>
      </div>)}
    </dl>
  </div>;
}

// ---------------------------------------------------------------------------
// Testimonios
// ---------------------------------------------------------------------------

/** «Carrusel con foto grande» (03): one story at a time; an optional YouTube/Vimeo
 * video loads its player only when requested (no third-party request before). */
export function TestimonialsCarousel({ block }: { block: Of<"testimonials"> }) {
  const items = block.content.items.filter(item => item.consent && item.quote && item.name);
  const [active, setActive] = useState(0);
  const [playing, setPlaying] = useState(false);
  const current = Math.min(active, Math.max(0, items.length - 1));
  const move = (index: number) => { setActive(Math.max(0, Math.min(items.length - 1, index))); setPlaying(false); };
  const item = items[current];
  if (!item) return null;
  const video = item.video_url ? parseVideoUrl(item.video_url) : null;
  const several = items.length > 1;
  return <div data-layout="testimonials-carousel" className="flex flex-col gap-8">
    <Heading block={block} />
    <div role="region" aria-roledescription="carrusel" aria-label="Testimonios" tabIndex={0}
      className="flex min-w-0 flex-col gap-6 rounded-3xl focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
      onKeyDown={event => {
        const index = { ArrowRight: current + 1, ArrowLeft: current - 1, Home: 0, End: items.length - 1 }[event.key];
        if (index !== undefined && event.target === event.currentTarget) { event.preventDefault(); move(index); }
      }}>
      <figure key={current} className="grid min-w-0 items-center gap-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <div className="relative aspect-4/3 min-w-0 overflow-hidden rounded-3xl bg-(--site-band)">
          {playing && video ? <VideoFrame video={video} title={`Video de ${item.name}`} className="size-full border-0" /> : <>
            {item.photo ? <SiteMedia image={item.photo} alt={`Retrato de ${item.name}`} className="size-full rounded-none" /> : <div className="flex size-full items-center justify-center"><Quote aria-hidden="true" className="size-16 text-(--site-brand-text)" /></div>}
            {video && <Button type="button" data-brand-surface="" className="absolute top-4 left-4 min-h-10 rounded-full" onClick={() => setPlaying(true)}><Play aria-hidden="true" data-icon="inline-start" />Ver video de {item.name}</Button>}
          </>}
        </div>
        <Card className="relative z-10 min-w-0 shadow-lg lg:-ml-24 [--card-spacing:--spacing(6)] sm:[--card-spacing:--spacing(8)]">
          <CardContent><blockquote><p className="text-xl leading-relaxed tracking-tight sm:text-2xl">{item.quote}</p></blockquote></CardContent>
          <CardFooter><figcaption className="flex items-center gap-3"><Avatar className="size-11"><AvatarImage src={item.photo ? mediaUrl(item.photo.media_id) : undefined} alt="" /><AvatarFallback>{initials(item.name!)}</AvatarFallback></Avatar><span className="flex flex-col"><span className="font-medium">{item.name}</span>{item.role && <span className="text-sm text-muted-foreground">{item.role}</span>}</span></figcaption></CardFooter>
        </Card>
      </figure>
      {several && <div className="flex items-center justify-between gap-4">
        <div aria-hidden="true" className="flex gap-2">{items.map((_, index) => <span key={index} className={cn("h-1.5 rounded-full bg-foreground/25", index === current ? "w-6 bg-foreground" : "w-1.5")} />)}</div>
        <div className="flex items-center gap-3">
          <Button variant="outline" size="icon" className="size-10 rounded-full" aria-label="Testimonio anterior" disabled={current === 0} onClick={() => move(current - 1)}><ChevronLeft aria-hidden="true" /></Button>
          <p role="status" aria-live="polite" aria-atomic="true" className="text-sm tabular-nums text-muted-foreground">{current + 1} de {items.length}</p>
          <Button variant="outline" size="icon" className="size-10 rounded-full" aria-label="Testimonio siguiente" disabled={current === items.length - 1} onClick={() => move(current + 1)}><ChevronRight aria-hidden="true" /></Button>
        </div>
      </div>}
    </div>
  </div>;
}

// ---------------------------------------------------------------------------
// Galería
// ---------------------------------------------------------------------------

/** «Tira de fotos» (03): a slow moving strip with a pause control; still and
 * hand-scrollable under reduced motion. The looping copy is hidden from assistive technology. */
export function PhotoStrip({ block }: { block: Of<"gallery"> }) {
  const reduced = usePrefersReducedMotion();
  const [paused, setPaused] = useState(false);
  const items = block.content.items.filter(item => item.image && item.alt);
  const frame = (item: (typeof items)[number], index: number, copy: boolean) => <li key={`${copy ? "copy" : "item"}-${index}`} aria-hidden={copy || undefined} className="w-64 shrink-0 pr-4 sm:w-80">
    <figure className="flex flex-col gap-3"><SiteMedia image={item.image} alt={copy ? "" : item.alt!} className="aspect-4/3 rounded-3xl" />{item.caption && <figcaption className="text-sm text-muted-foreground">{item.caption}</figcaption>}</figure>
  </li>;
  return <div data-layout="gallery-photo_strip" className="flex flex-col gap-6">
    <div className="flex flex-wrap items-end justify-between gap-4">
      <Heading block={block} />
      {!reduced && <Button type="button" variant="outline" className="min-h-10" onClick={() => setPaused(value => !value)}>{paused ? <Play aria-hidden="true" data-icon="inline-start" /> : <Pause aria-hidden="true" data-icon="inline-start" />}{paused ? "Reanudar fotos" : "Pausar fotos"}</Button>}
    </div>
    <div data-photo-strip="" data-paused={String(paused || reduced)} role={reduced ? "region" : undefined} aria-label={reduced ? "Fotos de la empresa" : undefined} tabIndex={reduced ? 0 : undefined}
      className={cn("min-w-0 rounded-3xl", reduced ? "overflow-x-auto focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring" : cn("overflow-hidden", styles.stripViewport))}>
      <ul className={cn("flex w-max", !reduced && styles.stripTrack)}>
        {items.map((item, index) => frame(item, index, false))}
        {!reduced && items.map((item, index) => frame(item, index, true))}
      </ul>
    </div>
  </div>;
}

// ---------------------------------------------------------------------------
// New sections
// ---------------------------------------------------------------------------

/** «Equipo / Líderes»: consented people only, like testimonials. */
export function Team({ block }: { block: Of<"team"> }) {
  const items = block.content.items.filter(item => item.consent && item.name);
  const intro = block.content.intro && <p className="text-base leading-relaxed text-muted-foreground">{block.content.intro}</p>;
  const avatar = (item: (typeof items)[number], className: string, fallback: string) => <Avatar className={className}>
    <AvatarImage src={item.photo ? mediaUrl(item.photo.media_id) : undefined} alt={`Retrato de ${item.name}`} />
    <AvatarFallback className={fallback}>{initials(item.name!)}</AvatarFallback>
  </Avatar>;
  if (block.variant === "portraits") return <div data-layout="team-portraits" className="flex flex-col gap-10">
    <Heading block={block}>{intro}</Heading>
    <ul className="grid grid-cols-2 gap-x-6 gap-y-10 sm:grid-cols-3 lg:grid-cols-4">{items.map((item, index) => <li key={index} className="flex min-w-0 flex-col items-center gap-4 text-center">
      {avatar(item, "size-28 ring-4 ring-(--card) sm:size-40", "text-2xl font-medium")}
      <div className="flex flex-col gap-1"><h3 className="text-lg font-medium">{item.name}</h3>{item.role && <p className="text-sm text-muted-foreground">{item.role}</p>}</div>
    </li>)}</ul>
  </div>;
  return <div data-layout="team-grid" className="flex flex-col gap-8">
    <Heading block={block}>{intro}</Heading>
    <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">{items.map((item, index) => <li key={index} className="min-w-0"><Card className="h-full">
      <CardHeader className="gap-3">{avatar(item, "mb-2 size-16", "text-lg font-medium")}<CardTitle><h3 className="text-lg">{item.name}</h3></CardTitle>{item.role && <CardDescription>{item.role}</CardDescription>}</CardHeader>
    </Card></li>)}</ul>
  </div>;
}

/** «Logos / Reconocimientos»: logos sit on a white tile so dark marks stay visible in dark mode. */
export function Logos({ block }: { block: Of<"logos"> }) {
  const centered = useSectionAlign() === "center";
  const items = block.content.items.filter(item => item.name && item.image);
  if (block.variant === "grid") return <div data-layout="logos-grid" className="flex flex-col gap-8">
    <Heading block={block} />
    <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">{items.map((item, index) => <li key={index} className="min-w-0"><Card className="h-full">
      <CardContent><figure className="flex flex-col items-center gap-3 text-center">
        <span className="flex h-20 w-full items-center justify-center rounded-2xl bg-white p-3"><img src={mediaUrl(item.image!.media_id)} alt="" loading="lazy" className="max-h-14 w-auto max-w-full object-contain" /></span>
        <figcaption className="flex flex-col gap-1"><span className="font-medium">{item.name}</span>{item.caption && <span className="text-sm text-muted-foreground">{item.caption}</span>}</figcaption>
      </figure></CardContent>
    </Card></li>)}</ul>
  </div>;
  return <div data-layout="logos-strip" className="flex flex-col gap-8">
    <Heading block={block} />
    <ul className={cn("flex flex-wrap items-center gap-4", centered && "justify-center")}>{items.map((item, index) => <li key={index} title={item.caption ?? undefined} className="inline-flex h-16 items-center rounded-2xl bg-white px-5 ring-1 ring-foreground/10">
      <img src={mediaUrl(item.image!.media_id)} alt={item.name!} loading="lazy" className="h-9 w-auto max-w-36 object-contain" />
    </li>)}</ul>
  </div>;
}

/** «Áreas de trabajo»: one card per area of the published vacancies; choosing one
 * filters the Vacantes section and scrolls to it (a removable chip shows the filter). */
export function Areas({ block, jobs }: { block: Of<"areas">; jobs: PublicJobItem[] }) {
  const filter = useSiteAreaFilter();
  const areas = deriveSiteAreas(jobs);
  const overrides = new Map(block.content.overrides.map(override => [override.key, override]));
  const photos = block.variant === "photo_cards";
  return <div data-layout={`areas-${block.variant}`} className="flex flex-col gap-8">
    <Heading block={block}>{block.content.intro && <p className="text-base leading-relaxed text-muted-foreground">{block.content.intro}</p>}</Heading>
    <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{areas.map(area => {
      const override = overrides.get(area.key);
      const Icon = SITE_ICONS[override?.icon ?? DEFAULT_AREA_ICONS[area.key]];
      const pressed = filter?.areas.length === 1 && filter.areas[0] === area.key;
      const count = <span className="text-sm">{plural(area.count, "vacante", "vacantes")}</span>;
      const label = <span className="font-heading text-lg leading-snug font-medium">{area.label}</span>;
      return <li key={area.key} className="min-w-0">
        {photos ? <button type="button" aria-pressed={pressed} onClick={() => filter?.showArea(area.key)} data-site-surface="scrim"
          className="relative isolate flex aspect-4/3 w-full flex-col items-start justify-end gap-1 overflow-hidden rounded-3xl p-4 text-left outline-none focus-visible:ring-3 focus-visible:ring-(--site-brand-text) focus-visible:ring-offset-2 aria-pressed:ring-3 aria-pressed:ring-(--site-brand-text) aria-pressed:ring-offset-2">
          <span aria-hidden="true" className="absolute inset-0 -z-10">
            {override?.photo ? <SiteMedia image={override.photo} alt="" className="size-full rounded-none" /> : <span className={cn("absolute inset-0", styles.heroGradient)} />}
            <span className="absolute inset-0" style={{ backgroundImage: AREA_PHOTO_SCRIM }} />
          </span>
          {label}{count}
        </button> : <button type="button" aria-pressed={pressed} onClick={() => filter?.showArea(area.key)}
          className="flex h-full w-full flex-col items-start gap-3 rounded-3xl bg-card p-5 text-left text-card-foreground shadow-sm ring-1 ring-foreground/10 outline-none hover:bg-primary/5 focus-visible:ring-2 focus-visible:ring-ring aria-pressed:bg-primary/5 aria-pressed:ring-2 aria-pressed:ring-(--site-brand-text)">
          <span aria-hidden="true" className="mb-1 inline-flex size-12 items-center justify-center rounded-2xl bg-(--site-band) text-(--site-brand-text)"><Icon className="size-6" /></span>
          {label}<span className="text-muted-foreground">{count}</span>
        </button>}
      </li>;
    })}</ul>
  </div>;
}

/** «Llamado a talento». TODO(slice C): the public «Dejar mi CV» form (POST
 * /v2/company-sites/{slug}/talent, `content.button_label`, consent, CV upload). Until it
 * ships the call to action only leads to the Vacantes section, and its text says so. */
export function TalentCta({ block, jobsHref }: { block: Of<"talent_cta">; jobsHref?: string }) {
  const centered = useSectionAlign() === "center";
  const titleId = `${siteAnchor(block)}-title`;
  if (block.variant === "split") return <div data-layout="talent_cta-split" className="grid items-center gap-8 lg:grid-cols-2 lg:gap-12">
    <Heading block={block}>{block.content.text && <p className="text-base leading-relaxed text-muted-foreground sm:text-lg">{block.content.text}</p>}</Heading>
    <Card className="[--card-spacing:--spacing(8)]">
      <CardHeader className="gap-3"><span aria-hidden="true" className="mb-2 inline-flex size-12 items-center justify-center rounded-2xl bg-(--site-band) text-(--site-brand-text)"><FileUser className="size-6" /></span><CardTitle><p className="text-xl">Revisa las vacantes abiertas</p></CardTitle><CardDescription>Quizá ya hay una oportunidad para ti.</CardDescription></CardHeader>
      <CardContent><JobsLink href={jobsHref} label="Ver vacantes abiertas" /></CardContent>
    </Card>
  </div>;
  return <div data-layout="talent_cta-banner"><Card data-brand-banner="" className={cn("[--card-spacing:--spacing(8)] sm:[--card-spacing:--spacing(12)]", centered && "text-center")}>
    <CardHeader className={cn("gap-4", centered && "justify-items-center")}>
      <span aria-hidden="true" className="mb-2 inline-flex size-12 items-center justify-center rounded-2xl bg-(--muted)"><FileUser className="size-6" /></span>
      <CardTitle><h2 id={titleId} className="max-w-[22ch] text-3xl leading-tight font-medium tracking-tight text-balance sm:text-5xl">{block.content.title}</h2></CardTitle>
      {block.content.text && <CardDescription className="max-w-prose text-base">{block.content.text}</CardDescription>}
    </CardHeader>
    <CardContent className={cn("flex flex-col gap-6", centered && "items-center")}><JobsLink href={jobsHref} label="Ver vacantes abiertas" onBrand centered={centered} /></CardContent>
  </Card></div>;
}
