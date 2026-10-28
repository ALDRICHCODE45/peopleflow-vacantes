import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { cache } from "react";
import { serverEnv } from "@/lib/env/server";
import { getPublicSite, listCompanyJobs } from "@/features/company-site/public/read";
import { CompanySitePage } from "../../../../features/company-site/public/company-site-page";
import { mediaUrl } from "@/features/company-site/public/media";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
type Props = { params: Promise<{ slug: string }> };
const read = cache(async (slug: string) => {
  const result = await getPublicSite(slug);
  if (result.kind === "notFound") notFound();
  if (result.kind === "moved") permanentRedirect(`/empresas/${result.slug}`);
  if (result.kind !== "found") throw new Error("No se pudo cargar el sitio");
  return result.data;
});
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const data = await read((await params).slug);
  const title = data.site.seo.title ?? `${data.company.name} · Empleos`;
  const description = data.site.seo.description ?? data.company.description ?? undefined;
  const canonical = new URL(`/empresas/${data.slug}`, serverEnv.siteUrl).toString();
  const hero = data.site.blocks.find(block => block.type === "hero" && !block.hidden);
  const cover = hero?.type === "hero" ? hero.content.cover : null;
  return {
    title, description, alternates: { canonical }, robots: { index: true, follow: true },
    openGraph: { title, description, url: canonical, ...(cover ? { images: [{ url: new URL(mediaUrl(cover.media_id), serverEnv.siteUrl).toString() }] } : {}) },
  };
}
export default async function Page({ params }: Props) {
  const data = await read((await params).slug);
  const jobs = await listCompanyJobs(data.company.id);
  if (!jobs.ok) throw new Error("No se pudieron cargar las vacantes");
  return <CompanySitePage data={data} jobs={jobs.data.items} />;
}
