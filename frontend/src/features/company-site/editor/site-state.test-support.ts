import { siteDraftReadSchemaV2, type SiteBlockV2, type SiteDraftV2 } from "../model";

/** The editor holds v2 drafts: normalize a legacy fixture document exactly as the API decoder does. */
export const v2Draft = (draft: unknown): SiteDraftV2 => siteDraftReadSchemaV2.parse(draft);
/** A single legacy fixture block in its normalized v2 shape (style and hero button defaults). */
export function v2Block<T extends SiteBlockV2["type"]>(block: { type: T } & Record<string, unknown>): Extract<SiteBlockV2, { type: T }> {
  const jobs = { id: "0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c7dff", type: "jobs", variant: "list", hidden: false, content: { title: null, intro: null } };
  const hero = { id: "0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c7dfe", type: "hero", variant: "photo", hidden: false, content: { title: null, subtitle: null, cover: null } };
  const blocks = block.type === "hero" ? [block, jobs] : block.type === "jobs" ? [hero, block] : [hero, jobs, block];
  const draft = v2Draft({ slug: null, theme: { brand_color: "#7835DB", accent_color: null, background_color: null, font_pair: "classic" }, seo: { title: null, description: null }, blocks });
  return draft.blocks[block.type === "hero" ? 0 : block.type === "jobs" ? 1 : 2] as Extract<SiteBlockV2, { type: T }>;
}
