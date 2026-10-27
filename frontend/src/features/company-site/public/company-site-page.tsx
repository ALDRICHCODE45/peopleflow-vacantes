/* eslint-disable @next/next/no-img-element -- Capability images are streamed by our same-origin proxy. */
import type { CSSProperties, ReactNode } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DraftRichDescriptionContent } from "@/features/jobs/drafts/ui/draft-rich-description";
import type { PublicJobItem } from "@/features/jobs/types";
import { getCountries, getMunicipalities, getStates } from "@/features/geo/client";
import type { LocationWrite } from "@/features/geo/model";
import { BLOCK_LIBRARY } from "../defaults";
import { adjustedBrandColor, readableOn } from "../brand";
import type { SiteBlock } from "../model";
import type { PublicSite } from "./schema";
import { mediaUrl } from "./media";
import { VideoPlayer } from "./video-player";
import { CompanyJobs } from "@/features/company-site/public/company-jobs";

const anchor = (block: SiteBlock) => `bloque-${block.id}`;
function blockTitle(block: SiteBlock): string {
  return ("title" in block.content && block.content.title) || BLOCK_LIBRARY[block.type].label;
}
function Media({ image, alt }: { image: { media_id: string } | null; alt: string }) {
  return image ? <img src={mediaUrl(image.media_id)} alt={alt} loading="lazy" className="max-w-full" /> : null;
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
function BlockContent({ block, jobs, offices }: { block: SiteBlock; jobs: PublicJobItem[]; offices: Map<string, string> }): ReactNode {
  switch (block.type) {
    case "hero": return <><Media image={block.content.cover} alt={block.content.title ?? ""} />{block.content.subtitle && <p>{block.content.subtitle}</p>}</>;
    case "story": return <>{block.content.body && <DraftRichDescriptionContent description={block.content.body} />}<Media image={block.content.image} alt={block.content.title ?? ""} /></>;
    case "values": case "benefits": return <>{block.type === "values" && block.content.mission && <p>{block.content.mission}</p>}<ul className="grid gap-4 sm:grid-cols-2">{block.content.items.map((item, index) => <li key={index}><h3 className="font-semibold">{item.title}</h3>{item.description && <p>{item.description}</p>}</li>)}</ul></>;
    case "stats": return <dl className="flex flex-wrap gap-6">{block.content.items.map((item, index) => <div key={index}><dt>{item.label}</dt><dd className="text-2xl font-semibold tabular-nums">{item.value}</dd></div>)}</dl>;
    case "process": return <ol className="grid list-inside list-decimal gap-4">{block.content.items.map((item, index) => <li key={index}><h3 className="inline font-semibold">{item.title}</h3>{item.description && <p>{item.description}</p>}{item.duration && <p>{item.duration}</p>}</li>)}</ol>;
    case "gallery": return <div className="grid gap-4 sm:grid-cols-2">{block.content.items.map((item, index) => <figure key={index}><Media image={item.image} alt={item.alt ?? ""} />{item.caption && <figcaption>{item.caption}</figcaption>}</figure>)}</div>;
    case "testimonials": return <div className="grid gap-6 sm:grid-cols-2">{block.content.items.filter(item => item.consent).map((item, index) => <figure key={index}><blockquote><p>{item.quote}</p></blockquote><figcaption><Media image={item.photo} alt={item.name ?? ""} />{item.name}{item.role && <p>{item.role}</p>}</figcaption></figure>)}</div>;
    case "video": return <>{block.content.video && <VideoPlayer video={block.content.video} title={block.content.title ?? "Video de la empresa"} />}{block.content.description && <p>{block.content.description}</p>}</>;
    case "offices": return <ul className="grid gap-4 sm:grid-cols-2">{block.content.items.map((item, index) => <li key={index}><h3 className="font-semibold">{item.name}</h3><address className="not-italic">{item.address && <p>{item.address}</p>}{offices.get(locationKey(item.location)) && <p>{offices.get(locationKey(item.location))}</p>}</address>{item.map_url && <a className="inline-flex min-h-10 items-center underline" href={item.map_url}>Ver mapa de {item.name}</a>}</li>)}</ul>;
    case "jobs": return <CompanyJobs jobs={jobs} />;
    // Static FAQ is intentionally expanded: no disclosure widget is needed for the minimal renderer.
    case "faq": return <dl className="grid gap-4">{block.content.items.map((item, index) => <div key={index}><dt className="font-semibold">{item.question}</dt><dd className="whitespace-pre-wrap">{item.answer}</dd></div>)}</dl>;
    case "closing": return block.content.text && <p>{block.content.text}</p>;
  }
}

/** Server composition: video consent and CompanyJobs are the only client islands. */
export async function CompanySitePage({ data, jobs }: { data: PublicSite; jobs: PublicJobItem[] }) {
  const blocks = data.site.blocks.filter(block => !block.hidden);
  const offices = await officeLabels(blocks);
  const light = adjustedBrandColor(data.site.theme.brand_color, "#FFFFFF").color;
  const dark = adjustedBrandColor(data.site.theme.brand_color, "#000000").color;
  // Theme token definitions, not inline surface painting (UI rules §3 exception).
  const style = { "--site-brand-light": light, "--site-on-brand-light": readableOn(light), "--site-brand-dark": dark, "--site-on-brand-dark": readableOn(dark) } as CSSProperties;
  const socials = [["Sitio web", data.company.website], ["LinkedIn", data.company.linkedin_url], ["Instagram", data.company.instagram_url], ["Facebook", data.company.facebook_url], ["X", data.company.twitter_url]];
  return <div data-font-pair={data.site.theme.font_pair} style={style} className="mx-auto flex max-w-6xl flex-col gap-8 px-6 py-8 font-sans">
    <header className="flex flex-col gap-4">
      <div className="flex items-center gap-3">{data.company.logo_url && <img src={data.company.logo_url} alt={`Logo de ${data.company.name}`} className="size-12 object-contain" />}<p className="text-xl font-semibold">{data.company.name}</p></div>
      {data.company.description && <p>{data.company.description}</p>}
      <nav aria-label="Secciones de la empresa" className="flex flex-wrap gap-4">{blocks.map(block => <a key={block.id} href={`#${anchor(block)}`} className="inline-flex min-h-10 items-center underline">{blockTitle(block)}</a>)}</nav>
    </header>
    {blocks.map(block => <section key={block.id} id={anchor(block)} data-block-type={block.type} data-variant={block.variant} className="scroll-mt-24">
      {/* Card-demo anatomy, real headings inside CardTitle. Media belongs to block content, not the card chrome. */}
      {block.type === "hero" ? <div className="flex flex-col gap-4"><h1 className="text-3xl font-semibold">{block.content.title}</h1><BlockContent block={block} jobs={jobs} offices={offices} /></div> : block.type === "jobs" ? <div className="flex flex-col gap-4"><h2 className="text-xl font-semibold">{blockTitle(block)}</h2>{block.content.intro && <p>{block.content.intro}</p>}<BlockContent block={block} jobs={jobs} offices={offices} /></div> : <Card><CardHeader><CardTitle><h2 className="text-xl font-semibold">{blockTitle(block)}</h2></CardTitle></CardHeader><CardContent className="grid gap-4"><BlockContent block={block} jobs={jobs} offices={offices} /></CardContent></Card>}
    </section>)}
    <footer className="flex flex-col gap-4"><nav aria-label="Redes de la empresa" className="flex flex-wrap gap-4">{socials.map(([name, href]) => href && <a key={name} href={href} className="inline-flex min-h-10 items-center underline">{name}</a>)}</nav><p>Sitio creado con <Link href="/" className="underline">PeopleFlow</Link></p></footer>
  </div>;
}
