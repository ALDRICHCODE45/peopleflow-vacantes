import type { CSSProperties } from "react";
import Link from "next/link";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Separator } from "@/components/ui/separator";
import { getCountries, getMunicipalities, getStates } from "@/features/geo/client";
import type { LocationWrite } from "@/features/geo/model";
import type { PublicJobItem } from "@/features/jobs/types";
import { deriveDraftDescriptionPlain } from "@/features/jobs/drafts/rich/plain";
import { cn } from "@/lib/utils";
import { siteBrandTokens } from "./theme-tokens";
import type { SiteBlock } from "../model";
import type { PublicSite } from "./schema";
import { editorial, modern } from "./fonts";
import { SiteNavigation } from "./site-navigation";
import { SiteBlockContent, SocialLinks } from "./site-blocks";
import styles from "./site-theme.module.css";

const anchor = (block: SiteBlock) => `bloque-${block.id}`;
/** Draft preview and public read share honest omission; no invented placeholder content. */
function hasContent(block: SiteBlock): boolean {
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
/** Resolve wire codes only through the existing anonymous server catalogs. Fail closed to address/name. */
async function officeLabels(blocks: SiteBlock[]): Promise<Map<string, string>> {
  const offices = blocks.flatMap(block => block.type === "offices" ? block.content.items : []);
  const locations = offices.flatMap(office => office.location ? [office.location] : []);
  const labels = new Map<string, string>();
  if (!locations.length) return labels;
  const [countries, states] = await Promise.all([getCountries(), locations.some(location => location.country === "MX" && location.state) ? getStates() : Promise.resolve(null)]);
  const stateCodes = [...new Set(locations.filter(location => location.country === "MX" && location.municipality && location.state).map(location => location.state!))];
  const municipalities = new Map(await Promise.all(stateCodes.map(async state => [state, await getMunicipalities(state)] as const)));
  for (const location of locations) {
    const country = countries.ok ? countries.data.items.find(item => item.id === location.country)?.name : undefined;
    const state = states?.ok ? states.data.items.find(item => item.id === location.state)?.name : undefined;
    const catalog = location.state ? municipalities.get(location.state) : undefined;
    const municipality = catalog?.ok ? catalog.data.items.find(item => item.id === location.municipality)?.name : undefined;
    if (country && (!location.state || state) && (!location.municipality || municipality)) labels.set(locationKey(location), [municipality, state, country].filter(Boolean).join(", "));
  }
  return labels;
}
const locationKey = (location: LocationWrite) => JSON.stringify(location);

/** Server read/geo boundary; props stay compatible with the existing public route. */
export async function CompanySitePage({ data, jobs }: { data: PublicSite; jobs: PublicJobItem[] }) {
  const blocks = data.site.blocks.filter(block => !block.hidden && hasContent(block));
  const offices = await officeLabels(blocks);
  // Dynamic token definitions only; paint belongs to the semantic theme and primitives.
  const style = siteBrandTokens(data.site.theme.brand_color) as CSSProperties;
  const jobsBlock = blocks.find(block => block.type === "jobs");
  const storyBlock = blocks.find(block => block.type === "story");
  return <div data-font-pair={data.site.theme.font_pair} style={style} className={cn(styles.site, editorial.variable, modern.variable, "min-w-0 bg-background text-foreground [overflow-wrap:anywhere]")}>
    <Link href="#contenido" className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:rounded-xl focus:bg-background focus:px-4 focus:py-3 focus:text-foreground focus:outline-2 focus:outline-ring">Saltar al contenido</Link>
    <header className="mx-auto flex max-w-7xl items-center justify-between gap-6 px-6 py-6 sm:px-10 lg:px-16">
      <div className="flex min-w-0 shrink-0 items-center gap-3"><Avatar className="size-10"><AvatarImage src={data.company.logo_url ?? undefined} alt={`Logo de ${data.company.name}`} /><AvatarFallback>{data.company.name.slice(0, 1)}</AvatarFallback></Avatar><p className="max-w-[16ch] text-lg font-semibold tracking-tight [overflow-wrap:anywhere]">{data.company.name}</p></div>
      <SiteNavigation blocks={blocks} companyName={data.company.name} />
    </header>
    <main id="contenido" tabIndex={-1} className="min-w-0 outline-none">
    {blocks.map(block => <section key={block.id} id={anchor(block)} aria-labelledby={`${anchor(block)}-title`} data-block-type={block.type} data-variant={block.variant} className={cn("scroll-mt-6", (block.type === "story" || block.type === "jobs" || block.type === "stats" && block.variant === "row" || block.type === "benefits" && block.variant === "grid" || block.type === "video" && block.variant === "split") && "bg-(--site-band)")}>
      <div className="mx-auto max-w-7xl px-6 py-10 sm:px-10 sm:py-14 lg:px-16 lg:py-16"><SiteBlockContent block={block} company={data.company} jobs={jobs} offices={offices} jobsHref={jobsBlock ? `#${anchor(jobsBlock)}` : undefined} storyHref={storyBlock ? `#${anchor(storyBlock)}` : undefined} /></div>
    </section>)}
    </main>
    <Separator />
    <footer className="mx-auto flex max-w-7xl flex-col gap-6 px-6 py-8 sm:px-10 lg:flex-row lg:flex-wrap lg:items-center lg:justify-between lg:px-16">
      <div className="flex flex-col gap-2"><p className="text-lg font-semibold">{data.company.name}</p>{data.company.description && <p className="max-w-prose text-sm leading-relaxed text-muted-foreground">{data.company.description}</p>}</div>
      <SocialLinks company={data.company} />
      <p className="w-full basis-full text-xs text-muted-foreground">Impulsado por <Link href="/" aria-label="PeopleFlow para empresas" className="inline-flex min-h-10 items-center font-semibold underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-ring">PeopleFlow</Link></p>
    </footer>
  </div>;
}
