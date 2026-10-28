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
  "star", "award", "medal", "crown", "flag", "compass", "map-pin", "mountain", "sun", "moon", "zap", "flame", "gem",
  "puzzle", "brain", "book-open", "pencil", "palette", "music", "camera", "code", "terminal", "cpu", "database", "cloud", "wifi",
  "smartphone", "monitor", "headphones", "message-circle", "mail", "phone", "megaphone", "bell", "trending-up", "chart-bar", "chart-pie",
  "dollar-sign", "wallet", "credit-card", "banknote", "shopping-bag", "car", "bike", "bus", "train-front", "baby", "dog", "cat",
  "utensils", "pizza", "apple", "salad", "heart-handshake", "hand-heart", "hand-helping", "thumbs-up", "party-popper", "cake", "gamepad-2",
  "tree-pine", "recycle", "sprout", "flower-2", "umbrella", "shield-check", "lock", "key", "scale", "building-2", "factory", "store",
  "wrench", "hammer", "hard-hat", "truck", "package", "infinity", "accessibility", "languages", "calendar-check", "timer", "bot", "microscope", "paintbrush", "film", "mic",
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
// Segmenter rejects adjacent emoji; the anchored grammar also rejects arbitrary
// combining marks, dangling joiners/selectors and malformed tag sequences.
const emojiSegmenter = new Intl.Segmenter("es", { granularity: "grapheme" });
// Pin Extended_Pictographic to the backend's Unicode 15.0 table: newer
// engines removed text-default symbols such as ♡ from the runtime property.
// Source: Unicode emoji-data.txt (https://www.unicode.org/license.html).
const pictographic15 = String.raw`[\u00A9\u00AE\u203C\u2049\u2122\u2139\u2194-\u2199\u21A9-\u21AA\u231A-\u231B\u2328\u2388\u23CF\u23E9-\u23F3\u23F8-\u23FA\u24C2\u25AA-\u25AB\u25B6\u25C0\u25FB-\u25FE\u2600-\u2605\u2607-\u2612\u2614-\u2685\u2690-\u2705\u2708-\u2712\u2714\u2716\u271D\u2721\u2728\u2733-\u2734\u2744\u2747\u274C\u274E\u2753-\u2755\u2757\u2763-\u2767\u2795-\u2797\u27A1\u27B0\u27BF\u2934-\u2935\u2B05-\u2B07\u2B1B-\u2B1C\u2B50\u2B55\u3030\u303D\u3297\u3299\u{1F000}-\u{1F0FF}\u{1F10D}-\u{1F10F}\u{1F12F}\u{1F16C}-\u{1F171}\u{1F17E}-\u{1F17F}\u{1F18E}\u{1F191}-\u{1F19A}\u{1F1AD}-\u{1F1E5}\u{1F201}-\u{1F20F}\u{1F21A}\u{1F22F}\u{1F232}-\u{1F23A}\u{1F23C}-\u{1F23F}\u{1F249}-\u{1F3FA}\u{1F400}-\u{1F53D}\u{1F546}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{1F774}-\u{1F77F}\u{1F7D5}-\u{1F7FF}\u{1F80C}-\u{1F80F}\u{1F848}-\u{1F84F}\u{1F85A}-\u{1F85F}\u{1F888}-\u{1F88F}\u{1F8AE}-\u{1F8FF}\u{1F90C}-\u{1F93A}\u{1F93C}-\u{1F945}\u{1F947}-\u{1FAFF}\u{1FC00}-\u{1FFFD}]`;
const emojiElement = String.raw`(?:${pictographic15}\uFE0F?[\u{1F3FB}-\u{1F3FF}]?(?:[\u{E0020}-\u{E007E}]+\u{E007F})?|[\u{1F1E6}-\u{1F1FF}]{2}|[0-9#*]\uFE0F?\u20E3)`;
const emojiSequence = new RegExp(`^${emojiElement}(?:\\u200D${emojiElement})*$`, "u");
export function emojiError(value: string): "invalid" | "too_long" | null {
  if (new TextEncoder().encode(value).length > 32) return "too_long";
  // A newer Segmenter may split Unicode-15 pictographs (♡‍🔥) or joined flag
  // elements. The pinned, fully anchored backend grammar is authoritative for
  // those ZWJ sequences; adjacent, unjoined emoji still fail that grammar.
  const singleSequence = [...emojiSegmenter.segment(value)].length === 1 || value.includes("\u200D");
  return singleSequence && emojiSequence.test(value) ? null : "invalid";
}
const decoratedItem = (max: number, stored = false) => z.object({
  icon: iconSchema.nullable().default(null),
  emoji: z.string().nullable().default(null),
  title: text(60), description: text(max),
}).strict().superRefine((item, ctx) => {
  const issue = (field: "icon" | "emoji", code: "required" | "not_allowed" | "invalid" | "too_long") => ctx.addIssue({ code: "custom", path: [field], message: code, params: { wireCode: code } });
  if (item.icon === null && item.emoji === null && !stored) issue("icon", "required");
  if (item.icon !== null && item.emoji !== null) issue("emoji", "not_allowed");
  if (item.emoji !== null) { const error = emojiError(item.emoji); if (error) issue("emoji", error); }
});
const common = { id: z.string().uuid(), hidden: z.boolean() };
export const heroBlockSchema = z.object({ ...common, type: z.literal("hero"), variant: z.enum(["photo", "split", "centered"]), content: z.object({ title: text(80), subtitle: text(200), cover: mediaRefSchema }).strict() }).strict();
export const storyBlockSchema = z.object({ ...common, type: z.literal("story"), variant: z.enum(["text", "text_image"]), content: z.object({ title: text(80), body: storyBodySchema, image: mediaRefSchema }).strict() }).strict();
export const valuesBlockSchema = z.object({ ...common, type: z.literal("values"), variant: z.enum(["grid", "list"]), content: z.object({ mission: text(300), items: z.array(decoratedItem(240)).max(8) }).strict() }).strict();
export const benefitsBlockSchema = z.object({ ...common, type: z.literal("benefits"), variant: z.enum(["grid", "compact"]), content: z.object({ items: z.array(decoratedItem(160)).max(24) }).strict() }).strict();
export const statsBlockSchema = z.object({ ...common, type: z.literal("stats"), variant: z.enum(["row", "cards"]), content: z.object({ items: z.array(z.object({ value: text(12), label: text(60) }).strict()).max(6) }).strict() }).strict();
export const processBlockSchema = z.object({ ...common, type: z.literal("process"), variant: z.enum(["steps", "timeline"]), content: z.object({ items: z.array(z.object({ title: text(60), description: text(200), duration: text(30) }).strict()).max(8) }).strict() }).strict();
export const galleryBlockSchema = z.object({ ...common, type: z.literal("gallery"), variant: z.enum(["grid", "mosaic", "carousel"]), content: z.object({ items: z.array(z.object({ image: mediaRefSchema, alt: text(160), caption: text(120) }).strict()).max(12) }).strict() }).strict();
export const testimonialsBlockSchema = z.object({ ...common, type: z.literal("testimonials"), variant: z.enum(["cards", "quote"]), content: z.object({ items: z.array(z.object({ quote: text(400), name: text(80), role: text(80), photo: mediaRefSchema, consent: z.boolean() }).strict()).max(6) }).strict() }).strict();
export const videoBlockSchema = z.object({ ...common, type: z.literal("video"), variant: z.enum(["wide", "split"]), content: z.object({ video: videoSchema.nullable(), title: text(80), description: text(200) }).strict() }).strict();
// The API stores and returns unset location parts as explicit nulls; the editor keeps the
// code-only write shape, so drop them before the shared (optional, non-null) geo schema.
const officeLocationSchema = z.preprocess(value => value !== null && typeof value === "object" && !Array.isArray(value)
  ? Object.fromEntries(Object.entries(value).filter(([, part]) => part !== null)) : value, locationWriteSchema);
export const officesBlockSchema = z.object({ ...common, type: z.literal("offices"), variant: z.enum(["list", "cards"]), content: z.object({ items: z.array(z.object({ name: text(80), location: officeLocationSchema, address: text(200), map_url: mapUrlSchema }).strict()).max(20) }).strict() }).strict();
export const jobsBlockSchema = z.object({ ...common, type: z.literal("jobs"), variant: z.enum(["list", "cards", "by_area"]), content: z.object({ title: text(80), intro: text(200) }).strict() }).strict();
export const faqBlockSchema = z.object({ ...common, type: z.literal("faq"), variant: z.enum(["accordion", "two_columns"]), content: z.object({ items: z.array(z.object({ question: text(160), answer: text(1000) }).strict()).max(20) }).strict() }).strict();
export const closingBlockSchema = z.object({ ...common, type: z.literal("closing"), variant: z.enum(["banner", "simple"]), content: z.object({ title: text(80), text: text(240) }).strict() }).strict();
export const blockSchema = z.discriminatedUnion("type", [heroBlockSchema, storyBlockSchema, valuesBlockSchema, benefitsBlockSchema, statsBlockSchema, processBlockSchema, galleryBlockSchema, testimonialsBlockSchema, videoBlockSchema, officesBlockSchema, jobsBlockSchema, faqBlockSchema, closingBlockSchema]);
export type SiteBlock = z.infer<typeof blockSchema>;
export type BlockType = SiteBlock["type"];

const siteDraftObject = z.object({
  slug: text(60).refine(value => value === null || validateSlug(value) === null, "Invalid or reserved slug"),
  theme: z.object({
    brand_color: z.string().trim().regex(/^#[0-9a-fA-F]{6}$/).transform(value => value.toUpperCase()),
    accent_color: z.string().regex(/^#[0-9a-fA-F]{6}$/).transform(value => value.toUpperCase()).nullable().default(null),
    background_color: z.string().regex(/^#[0-9a-fA-F]{6}$/).transform(value => value.toUpperCase()).nullable().default(null),
    font_pair: z.enum(["classic", "editorial", "modern"]),
  }).strict(),
  seo: z.object({ title: text(60), description: text(160) }).strict(),
  blocks: z.array(blockSchema).min(2).max(30),
}).strict();
const draftInvariants = (draft: z.infer<typeof siteDraftObject>, ctx: z.RefinementCtx) => {
  const ids = new Set<string>();
  draft.blocks.forEach((block, index) => {
    if (ids.has(block.id)) ctx.addIssue({ code: "custom", path: ["blocks", index, "id"], message: "Duplicate block id" });
    ids.add(block.id);
    if ((block.type === "hero" || block.type === "jobs") && block.hidden) ctx.addIssue({ code: "custom", path: ["blocks", index, "hidden"], message: "Required block cannot be hidden" });
  });
  for (const type of ["hero", "jobs"]) {
    if (draft.blocks.filter(block => block.type === type).length !== 1) ctx.addIssue({ code: "custom", path: ["blocks"], message: `Exactly one ${type} required` });
  }
};
export const siteDraftSchema = siteDraftObject.superRefine(draftInvariants);
// Read-only compatibility: retain strict objects and validate every supplied
// decoration, but normalize absent keys and tolerate undecorated legacy items.
const storedValues = valuesBlockSchema.extend({ content: valuesBlockSchema.shape.content.extend({ items: z.array(decoratedItem(240, true)).max(8) }) });
const storedBenefits = benefitsBlockSchema.extend({ content: benefitsBlockSchema.shape.content.extend({ items: z.array(decoratedItem(160, true)).max(24) }) });
const storedBlock = z.discriminatedUnion("type", [heroBlockSchema, storyBlockSchema, storedValues, storedBenefits, statsBlockSchema, processBlockSchema, galleryBlockSchema, testimonialsBlockSchema, videoBlockSchema, officesBlockSchema, jobsBlockSchema, faqBlockSchema, closingBlockSchema]);
export const siteDraftReadSchema = siteDraftObject.extend({ blocks: z.array(storedBlock).min(2).max(30) }).superRefine(draftInvariants);
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
