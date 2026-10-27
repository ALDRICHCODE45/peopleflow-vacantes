import { defaultSiteDraft, defaultBlock } from "../defaults";
import type { SiteDraft } from "../model";
import type { PublicSite } from "./schema";

export const companyId = "0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c7d93";
export const mediaId = "0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c7d94";
export function publishedFixture(): PublicSite {
  const { slug: _slug, ...site } = defaultSiteDraft();
  void _slug;
  site.blocks[0] = { ...defaultBlock("hero"), type: "hero", variant: "photo", content: { title: "Trabaja con Nexo", subtitle: "Creamos juntos", cover: { media_id: mediaId } } };
  return {
    company: { id: companyId, name: "Nexo", logo_url: "https://example.com/logo.png", description: "Un equipo real", website: "https://example.com", linkedin_url: null, instagram_url: null, facebook_url: null, twitter_url: null, location: null },
    site: site as Omit<SiteDraft, "slug">, slug: "nexo-labs", published_at: "2026-10-27T00:00:00Z",
    media: [{ id: mediaId, kind: "cover" as const, url: `/v2/company-sites/media/${mediaId}`, width: 1920, height: 1080 }],
  };
}
