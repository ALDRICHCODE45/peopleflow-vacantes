import { z } from "zod";

import { locationWriteSchema } from "../geo/model";
import { draftRichDescriptionSchema } from "../jobs/drafts/rich/description";
import { deriveDraftDescriptionPlain } from "../jobs/drafts/rich/plain";
import { validateSlug } from "./slug";
import { videoSchema } from "./video";

export const ICONS = [
  "heart", "users", "rocket", "target", "lightbulb", "shield", "leaf", "globe", "graduation-cap",
  "briefcase", "laptop", "clock", "calendar", "coffee", "dumbbell", "stethoscope", "piggy-bank",
  "gift", "plane", "home", "sparkles", "handshake", "trophy", "smile",
] as const;
export const iconSchema = z.enum(ICONS);

/** Nullable wire fields stay present; empty editor inputs normalize to null. */
const text = (max: number) => z.string().trim()
  .refine(value => [...value].length <= max, `Maximum ${max} code points`)
  .transform(value => value === "" ? null : value).nullable();
export const mediaRefSchema = z.object({ media_id: z.string().uuid() }).strict().nullable();
// A pipeline only derives after the shared validator succeeds (including its
// byte budgets); a chained refine also runs on dirty values and could throw.
const storyBodySchema = draftRichDescriptionSchema.pipe(
  z.custom<z.infer<typeof draftRichDescriptionSchema>>().refine(
    body => [...(deriveDraftDescriptionPlain(body) ?? "")].length <= 5000,
    "Maximum 5000 plain-text code points",
  ),
);
const mapUrlSchema = text(500).refine(value => {
  if (value === null) return true;
  try { return new URL(value).protocol === "https:"; } catch { return false; }
}, "Expected an HTTPS URL");
const common = { id: z.string().uuid(), hidden: z.boolean() };
export const heroBlockSchema = z.object({ ...common, type: z.literal("hero"), variant: z.enum(["photo", "split", "centered"]), content: z.object({ title: text(80), subtitle: text(200), cover: mediaRefSchema }).strict() }).strict();
export const storyBlockSchema = z.object({ ...common, type: z.literal("story"), variant: z.enum(["text", "text_image"]), content: z.object({ title: text(80), body: storyBodySchema, image: mediaRefSchema }).strict() }).strict();
export const valuesBlockSchema = z.object({ ...common, type: z.literal("values"), variant: z.enum(["grid", "list"]), content: z.object({ mission: text(300), items: z.array(z.object({ icon: iconSchema, title: text(60), description: text(240) }).strict()).max(8) }).strict() }).strict();
export const benefitsBlockSchema = z.object({ ...common, type: z.literal("benefits"), variant: z.enum(["grid", "compact"]), content: z.object({ items: z.array(z.object({ icon: iconSchema, title: text(60), description: text(160) }).strict()).max(24) }).strict() }).strict();
export const statsBlockSchema = z.object({ ...common, type: z.literal("stats"), variant: z.enum(["row", "cards"]), content: z.object({ items: z.array(z.object({ value: text(12), label: text(60) }).strict()).max(6) }).strict() }).strict();
export const processBlockSchema = z.object({ ...common, type: z.literal("process"), variant: z.enum(["steps", "timeline"]), content: z.object({ items: z.array(z.object({ title: text(60), description: text(200), duration: text(30) }).strict()).max(8) }).strict() }).strict();
export const galleryBlockSchema = z.object({ ...common, type: z.literal("gallery"), variant: z.enum(["grid", "mosaic", "carousel"]), content: z.object({ items: z.array(z.object({ image: mediaRefSchema, alt: text(160), caption: text(120) }).strict()).max(12) }).strict() }).strict();
export const testimonialsBlockSchema = z.object({ ...common, type: z.literal("testimonials"), variant: z.enum(["cards", "quote"]), content: z.object({ items: z.array(z.object({ quote: text(400), name: text(80), role: text(80), photo: mediaRefSchema, consent: z.boolean() }).strict()).max(6) }).strict() }).strict();
export const videoBlockSchema = z.object({ ...common, type: z.literal("video"), variant: z.enum(["wide", "split"]), content: z.object({ video: videoSchema.nullable(), title: text(80), description: text(200) }).strict() }).strict();
export const officesBlockSchema = z.object({ ...common, type: z.literal("offices"), variant: z.enum(["list", "cards"]), content: z.object({ items: z.array(z.object({ name: text(80), location: locationWriteSchema, address: text(200), map_url: mapUrlSchema }).strict()).max(20) }).strict() }).strict();
export const jobsBlockSchema = z.object({ ...common, type: z.literal("jobs"), variant: z.enum(["list", "cards", "by_area"]), content: z.object({ title: text(80), intro: text(200) }).strict() }).strict();
export const faqBlockSchema = z.object({ ...common, type: z.literal("faq"), variant: z.enum(["accordion", "two_columns"]), content: z.object({ items: z.array(z.object({ question: text(160), answer: text(1000) }).strict()).max(20) }).strict() }).strict();
export const closingBlockSchema = z.object({ ...common, type: z.literal("closing"), variant: z.enum(["banner", "simple"]), content: z.object({ title: text(80), text: text(240) }).strict() }).strict();
export const blockSchema = z.discriminatedUnion("type", [heroBlockSchema, storyBlockSchema, valuesBlockSchema, benefitsBlockSchema, statsBlockSchema, processBlockSchema, galleryBlockSchema, testimonialsBlockSchema, videoBlockSchema, officesBlockSchema, jobsBlockSchema, faqBlockSchema, closingBlockSchema]);
export type SiteBlock = z.infer<typeof blockSchema>;
export type BlockType = SiteBlock["type"];

export const siteDraftSchema = z.object({
  slug: text(60).refine(value => value === null || validateSlug(value) === null, "Invalid or reserved slug"),
  theme: z.object({
    brand_color: z.string().trim().regex(/^#[0-9a-fA-F]{6}$/).transform(value => value.toUpperCase()),
    accent_color: z.string().regex(/^#[0-9a-fA-F]{6}$/).transform(value => value.toUpperCase()).nullable().default(null),
    background_color: z.string().regex(/^#[0-9a-fA-F]{6}$/).transform(value => value.toUpperCase()).nullable().default(null),
    font_pair: z.enum(["classic", "editorial", "modern"]),
  }).strict(),
  seo: z.object({ title: text(60), description: text(160) }).strict(),
  blocks: z.array(blockSchema).min(2).max(30),
}).strict().superRefine((draft, ctx) => {
  const ids = new Set<string>();
  draft.blocks.forEach((block, index) => {
    if (ids.has(block.id)) ctx.addIssue({ code: "custom", path: ["blocks", index, "id"], message: "Duplicate block id" });
    ids.add(block.id);
    if ((block.type === "hero" || block.type === "jobs") && block.hidden) ctx.addIssue({ code: "custom", path: ["blocks", index, "hidden"], message: "Required block cannot be hidden" });
  });
  for (const type of ["hero", "jobs"]) {
    if (draft.blocks.filter(block => block.type === type).length !== 1) ctx.addIssue({ code: "custom", path: ["blocks"], message: `Exactly one ${type} required` });
  }
});
export type SiteDraft = z.infer<typeof siteDraftSchema>;
export type PublishIssue = {
  code: "slug_missing" | "hero_title_missing" | "no_content_block" | "block_incomplete" | "company_logo_missing" | "company_name_missing";
  field: string | null;
};
const present = (value: string | null | undefined) => Boolean(value?.trim());

function complete(block: SiteBlock): boolean {
  switch (block.type) {
    case "hero": return present(block.content.title);
    case "jobs": return true;
    case "story": return present(deriveDraftDescriptionPlain(block.content.body));
    case "values": case "benefits": return block.content.items.length >= 1 && block.content.items.every(item => present(item.title));
    case "stats": return block.content.items.length >= 1 && block.content.items.every(item => present(item.value) && present(item.label));
    case "process": return block.content.items.length >= 2 && block.content.items.every(item => present(item.title));
    case "gallery": return block.content.items.length >= 2 && block.content.items.every(item => item.image !== null && present(item.alt));
    case "testimonials": return block.content.items.length >= 1 && block.content.items.every(item => present(item.quote) && present(item.name) && item.consent === true);
    case "video": return block.content.video !== null;
    case "offices": return block.content.items.length >= 1 && block.content.items.every(item => present(item.name) && present(item.location?.country));
    case "faq": return block.content.items.length >= 1 && block.content.items.every(item => present(item.question) && present(item.answer));
    case "closing": return present(block.content.title);
  }
}

/** Publish checks supplement save validation; callers pass a parsed draft. */
export function publishIssues(draft: SiteDraft, company: { name: string | null; logo_url: string | null }): PublishIssue[] {
  const issues: PublishIssue[] = [];
  if (!present(draft.slug)) issues.push({ code: "slug_missing", field: "slug" });
  draft.blocks.forEach((block, index) => {
    if (!block.hidden && !complete(block)) issues.push({ code: block.type === "hero" ? "hero_title_missing" : "block_incomplete", field: `blocks[${index}]` });
  });
  if (!draft.blocks.some(block => !block.hidden && block.type !== "hero" && block.type !== "jobs")) issues.push({ code: "no_content_block", field: null });
  if (!present(company.logo_url)) issues.push({ code: "company_logo_missing", field: null });
  if (!present(company.name)) issues.push({ code: "company_name_missing", field: null });
  return issues;
}
