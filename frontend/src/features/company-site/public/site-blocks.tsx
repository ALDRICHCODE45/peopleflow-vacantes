"use client";
import type { ReactNode } from "react";
import { ArrowDown, ArrowUpRight, Clock, MapPin, Quote } from "lucide-react";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Item, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from "@/components/ui/item";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { DraftRichDescriptionContent } from "@/features/jobs/drafts/ui/draft-rich-description";
import type { PublicJobItem } from "@/features/jobs/types";
import { BLOCK_LIBRARY } from "../defaults";
import type { SiteBlock } from "../model";
import type { PublicSite } from "./schema";
import { SITE_ICONS } from "./site-icons";
import { SiteMedia } from "./site-media";
import { SiteGallery } from "./site-gallery";
import { mediaUrl } from "./media";
import { VideoPlayer } from "./video-player";
import { CompanyJobs } from "./company-jobs";

export const siteAnchor = (block: SiteBlock) => `bloque-${block.id}`;
export function siteBlockTitle(block: SiteBlock): string {
  return ("title" in block.content && block.content.title) || BLOCK_LIBRARY[block.type].label;
}
export function SocialLinks({ company, onBrand = false, centered = false, placement = "footer" }: { company: PublicSite["company"]; onBrand?: boolean; centered?: boolean; placement?: "footer" | "closing" }) {
  const links = [["Sitio web", company.website], ["LinkedIn", company.linkedin_url], ["Instagram", company.instagram_url], ["Facebook", company.facebook_url], ["X", company.twitter_url]];
  if (!links.some(([, href]) => href)) return null;
  const list = <ul className={cn("flex flex-wrap items-center gap-x-6 gap-y-2", centered && "justify-center", placement === "closing" && "-mx-3")} data-brand-text-link={placement === "closing" && !onBrand ? "" : undefined}>
    {links.map(([label, href]) => href && <li key={label}><Button nativeButton={false} role="link" className="min-h-10" variant={onBrand ? "ghost" : "link"} render={<a href={href} />}>{label}<ArrowUpRight aria-hidden="true" data-icon="inline-end" /></Button></li>)}
  </ul>;
  // Repeated closing blocks are lists, not duplicate navigation landmarks.
  return placement === "closing" ? list : <nav aria-label={`Redes de ${company.name} en el pie`} className="-mx-3" data-brand-text-link="">{list}</nav>;
}
function Heading({ block, children }: { block: SiteBlock; children?: ReactNode }) {
  return <div className="flex max-w-prose flex-col gap-4">
    {siteBlockTitle(block) !== BLOCK_LIBRARY[block.type].label && <p className="text-xs font-medium tracking-widest text-(--site-brand-text) uppercase">{BLOCK_LIBRARY[block.type].label}</p>}
    <h2 id={`${siteAnchor(block)}-title`} className="max-w-[24ch] text-3xl leading-tight font-medium tracking-tight text-balance sm:text-4xl lg:text-5xl">{siteBlockTitle(block)}</h2>
    {children}
  </div>;
}
function JobsLink({ href, onBrand = false, centered = false }: { href?: string; onBrand?: boolean; centered?: boolean }) {
  if (!href) return null;
  return <Button nativeButton={false} role="link" data-brand-surface={onBrand ? undefined : ""} data-brand-inverse={onBrand ? "" : undefined} className={cn("min-h-10 w-full sm:w-auto", centered ? "sm:self-center" : "sm:self-start")} render={<a href={href} />}>Ver vacantes<ArrowDown aria-hidden="true" data-icon="inline-end" /></Button>;
}

export function SiteBlockContent({ block, company, jobs, offices, jobsHref, storyHref }: { block: SiteBlock; company: PublicSite["company"]; jobs: PublicJobItem[]; offices: Map<string, string>; jobsHref?: string; storyHref?: string }) {
  const marker = `${block.type}-${block.variant}`;
  switch (block.type) {
    case "hero": {
      const split = block.variant === "split";
      return <div data-layout={marker} className={cn("grid items-center gap-8 sm:gap-12", split && block.content.cover && "lg:grid-cols-2")}>
        <div className={cn("flex flex-col gap-6", !split && "mx-auto max-w-3xl items-center text-center")}>
          <p className="text-xs font-medium tracking-widest text-(--site-brand-text) uppercase">{company.name} · Tu próximo capítulo</p>
          <h1 id={`${siteAnchor(block)}-title`} className="text-4xl leading-[1.12] font-medium tracking-tight text-balance whitespace-pre-line sm:text-5xl lg:text-6xl">{block.content.title}</h1>
          {block.content.subtitle && <p className="max-w-[48ch] text-base leading-relaxed text-pretty text-muted-foreground sm:text-lg">{block.content.subtitle}</p>}
          <div className="flex w-full flex-col items-center gap-3 sm:w-auto sm:flex-row"><JobsLink href={jobsHref} />{storyHref && <Button nativeButton={false} role="link" variant="ghost" className="min-h-10 w-full sm:w-auto" render={<a href={storyHref} />}>Conoce la empresa<ArrowDown aria-hidden="true" data-icon="inline-end" /></Button>}</div>
        </div>
        {block.variant !== "centered" && <SiteMedia eager image={block.content.cover} alt={block.content.title ?? `Equipo de ${company.name}`} className={cn("aspect-[2.3]", split && "aspect-4/3 lg:aspect-4/5")} />}
      </div>;
    }
    case "story": return <div data-layout={marker} className={cn("grid items-center gap-8 lg:gap-12", "lg:grid-cols-2")}>
      {block.variant === "text_image" && block.content.image && <SiteMedia image={block.content.image} alt={block.content.title ?? `Historia de ${company.name}`} className="aspect-4/3 lg:row-span-2" />}
      <Heading block={block} />
      {block.content.body && <div className={cn("min-w-0 text-base leading-relaxed text-muted-foreground", block.variant === "text_image" && block.content.image && "lg:col-start-2")}><DraftRichDescriptionContent description={block.content.body} /></div>}
    </div>;
    case "values": case "benefits": {
      const grid = block.variant === "grid";
      const items = block.content.items.filter(item => item.title);
      return <div data-layout={marker} className={cn("grid gap-8", !grid && "lg:grid-cols-[1fr_1.5fr] lg:gap-12")}>
        <Heading block={block}>{block.type === "values" && block.content.mission && <p className="text-base leading-relaxed text-muted-foreground">{block.content.mission}</p>}</Heading>
        {grid ? <div className={cn("grid gap-5 sm:grid-cols-2", block.type === "values" && "lg:grid-cols-3")}>{items.map((item, index) => {
          const Icon = SITE_ICONS[item.icon];
          return <Card key={index}><CardHeader><Icon data-site-icon={item.icon} aria-hidden="true" className="mb-4 size-7 text-(--site-brand-text)" /><CardTitle><h3>{item.title}</h3></CardTitle></CardHeader>{item.description && <CardContent><p className="leading-relaxed text-muted-foreground">{item.description}</p></CardContent>}</Card>;
        })}</div> : <ItemGroup>{items.map((item, index) => {
          const Icon = SITE_ICONS[item.icon];
          return <Item key={index} variant="outline" role="listitem"><ItemMedia variant="icon"><Icon data-site-icon={item.icon} aria-hidden="true" /></ItemMedia><ItemContent><ItemTitle><h3>{item.title}</h3></ItemTitle>{item.description && <ItemDescription className="line-clamp-none">{item.description}</ItemDescription>}</ItemContent></Item>;
        })}</ItemGroup>}
      </div>;
    }
    case "stats": return <div data-layout={marker} className={cn("grid gap-8", block.variant === "cards" && "lg:grid-cols-[1fr_1.5fr] lg:gap-12")}>
      <Heading block={block} />
      {/* Auto-fit prevents the approved reference's three narrow columns breaking Monterrey. */}
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,18rem),1fr))] gap-6">
        {block.content.items.filter(item => item.value && item.label).map((item, index) => {
          const valueClass = cn("leading-tight font-medium tracking-tight [overflow-wrap:normal] [word-break:normal]", [...item.value!].length > 10 ? "text-xl" : [...item.value!].length > 6 ? "text-2xl" : "text-4xl sm:text-5xl");
          return block.variant === "cards" ? <Card key={index} data-brand-banner={index === 0 ? "" : undefined} className={cn(index === 0 && "col-span-full")}>
            <CardHeader><CardDescription>{item.label}</CardDescription><CardTitle><p className={valueClass}>{item.value}</p></CardTitle></CardHeader>
          </Card> : <div key={index} className="flex min-w-0 flex-col gap-4"><Separator /><dl className="flex flex-col gap-3"><dt className="order-last text-sm text-muted-foreground">{item.label}</dt><dd className={cn(valueClass, "text-(--site-brand-text)")}>{item.value}</dd></dl></div>;
        })}
      </div>
    </div>;
    case "process": return <div data-layout={marker} className="flex flex-col gap-8"><Heading block={block} />
      <ol className={cn("grid gap-6", block.variant === "steps" && "sm:grid-cols-2 lg:grid-cols-3", block.variant === "timeline" && "lg:ml-auto lg:w-4/5")}>
        {block.content.items.filter(item => item.title).map((item, index) => <li key={index} className={cn("flex flex-col gap-4", block.variant === "timeline" && "border-l border-border pl-6")}>
          <Separator />
          <div className={cn("flex flex-col gap-4", block.variant === "timeline" && "sm:grid sm:grid-cols-[auto_1fr_1.3fr] sm:gap-6")}>
            <Badge variant="outline">{String(index + 1).padStart(2, "0")}</Badge><h3 className="text-lg font-medium">{item.title}</h3>
            <div className="flex flex-col gap-3">{item.description && <p className="text-sm leading-relaxed text-muted-foreground">{item.description}</p>}{item.duration && <p className="flex items-center gap-2 text-sm text-muted-foreground"><Clock className="size-4" aria-hidden="true" />{item.duration}</p>}</div>
          </div>
        </li>)}
      </ol>
    </div>;
    case "gallery": return <div className="flex flex-col gap-8"><Heading block={block} /><SiteGallery block={block} /></div>;
    case "testimonials": return <div data-layout={marker} className="flex flex-col gap-8"><Heading block={block} />
      <div className={cn("grid gap-6", block.variant === "cards" && "lg:grid-cols-2")}>
        {block.content.items.filter(item => item.consent && item.quote && item.name).map((item, index) => <Card key={index} className={cn(block.variant === "quote" && "mx-auto w-full max-w-4xl text-center")}>
          {block.variant === "cards" && <SiteMedia image={item.photo} alt={`Retrato de ${item.name}`} className="aspect-[1.7]" />}
          <CardContent><blockquote className="flex flex-col gap-4"><Quote aria-hidden="true" className={cn("size-8 text-(--site-brand-text)", block.variant === "quote" && "mx-auto")} /><p className="text-xl leading-relaxed tracking-tight sm:text-2xl">{item.quote}</p></blockquote></CardContent>
          <CardFooter className={cn("gap-3", block.variant === "quote" && "justify-center")}><Avatar><AvatarImage src={item.photo ? mediaUrl(item.photo.media_id) : undefined} alt={`Retrato de ${item.name}`} /><AvatarFallback>{item.name?.slice(0, 1)}</AvatarFallback></Avatar><div><p className="font-medium">{item.name}</p>{item.role && <p className="text-sm text-muted-foreground">{item.role}</p>}</div></CardFooter>
        </Card>)}
      </div>
    </div>;
    case "video": return <div data-layout={marker} className={cn("grid items-center gap-8", block.variant === "split" && "lg:grid-cols-[.7fr_1.3fr] lg:gap-12")}>
      <Heading block={block}>{block.content.description && <p className="text-base leading-relaxed text-muted-foreground">{block.content.description}</p>}</Heading>
      {block.content.video && <div className="w-full min-w-0"><VideoPlayer video={block.content.video} title={block.content.title ?? `Video de ${company.name}`} /></div>}
    </div>;
    case "offices": return <div data-layout={marker} className={cn("grid gap-8", block.variant === "list" && "lg:grid-cols-[1fr_1.3fr] lg:gap-12")}><Heading block={block} />
      {block.variant === "cards" ? <div className="grid gap-5 sm:grid-cols-2">{block.content.items.filter(item => item.name).map((item, index) => <Card key={index}><CardHeader><MapPin className="mb-3 size-6 text-(--site-brand-text)" aria-hidden="true" /><CardTitle><h3>{item.name}</h3></CardTitle></CardHeader><CardContent><OfficeAddress address={item.address} label={offices.get(JSON.stringify(item.location))} /></CardContent>{item.map_url && <CardFooter><Button data-brand-text-link="" nativeButton={false} role="link" className="min-h-10" variant="link" aria-label={`Ver mapa de ${item.name}`} render={<a href={item.map_url} />}>Ver mapa<ArrowUpRight aria-hidden="true" data-icon="inline-end" /></Button></CardFooter>}</Card>)}</div> : <ItemGroup>{block.content.items.filter(item => item.name).map((item, index) => <Item key={index} variant="outline" role="listitem"><ItemMedia variant="icon"><MapPin aria-hidden="true" /></ItemMedia><ItemContent><ItemTitle><h3>{item.name}</h3></ItemTitle><OfficeAddress address={item.address} label={offices.get(JSON.stringify(item.location))} />{item.map_url && <Button data-brand-text-link="" nativeButton={false} role="link" className="min-h-10 self-start" variant="link" aria-label={`Ver mapa de ${item.name}`} render={<a href={item.map_url} />}>Ver mapa<ArrowUpRight aria-hidden="true" data-icon="inline-end" /></Button>}</ItemContent></Item>)}</ItemGroup>}
    </div>;
    case "jobs": return <div data-layout={marker} className="flex flex-col gap-8"><Heading block={block}>{block.content.intro && <p className="text-base leading-relaxed text-muted-foreground">{block.content.intro}</p>}</Heading><CompanyJobs jobs={jobs} variant={block.variant} /></div>;
    case "faq": return <div data-layout={marker} className={cn("grid gap-8", block.variant === "accordion" && "lg:grid-cols-[1fr_1.5fr] lg:gap-12")}><Heading block={block} />
      {block.variant === "accordion" ? <Accordion>{block.content.items.filter(item => item.question && item.answer).map((item, index) => <AccordionItem key={index} value={String(index)}><AccordionTrigger>{item.question}</AccordionTrigger><AccordionContent><p className="leading-relaxed whitespace-pre-wrap">{item.answer}</p></AccordionContent></AccordionItem>)}</Accordion> : <div className="grid gap-8 sm:grid-cols-2">{block.content.items.filter(item => item.question && item.answer).map((item, index) => <div key={index} className="flex flex-col gap-3"><h3 className="text-lg font-medium">{item.question}</h3><p className="text-sm leading-relaxed whitespace-pre-wrap text-muted-foreground">{item.answer}</p></div>)}</div>}
    </div>;
    case "closing": return <div data-layout={marker}><Card data-brand-banner={block.variant === "banner" ? "" : undefined} className="text-center [--card-spacing:--spacing(8)] sm:[--card-spacing:--spacing(12)]">
      <CardHeader className="gap-4"><CardTitle><h2 id={`${siteAnchor(block)}-title`} className="mx-auto max-w-[22ch] text-3xl leading-tight font-medium tracking-tight text-balance sm:text-5xl">{block.content.title}</h2></CardTitle>{block.content.text && <CardDescription>{block.content.text}</CardDescription>}</CardHeader>
      <CardContent className="flex flex-col items-center gap-6"><JobsLink href={jobsHref} centered onBrand={block.variant === "banner"} /><SocialLinks company={company} placement="closing" centered onBrand={block.variant === "banner"} /></CardContent>
    </Card></div>;
  }
}
function OfficeAddress({ address, label }: { address: string | null; label?: string }) {
  return address || label ? <address className="text-sm leading-relaxed text-muted-foreground not-italic">{address && <p>{address}</p>}{label && <p>{label}</p>}</address> : null;
}
