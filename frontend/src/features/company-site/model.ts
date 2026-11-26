import { z } from "zod";

import { locationWriteSchema } from "../geo/model";
import { draftRichDescriptionSchema } from "../jobs/drafts/rich/description";
import { deriveDraftDescriptionPlain } from "../jobs/drafts/rich/plain";
import { PROFESSIONAL_AREAS } from "../jobs/drafts/scalars";
import { SECTIONS_V2_ENABLED } from "./sections-v2";
import { validateSlug } from "./slug";
import { parseVideoUrl, videoSchema } from "./video";

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
// U+200D joins pictographic elements only; flags, keycaps and tag sequences stand alone.
const joinableElement = String.raw`${pictographic15}\uFE0F?[\u{1F3FB}-\u{1F3FF}]?`;
const standaloneElement = String.raw`${joinableElement}[\u{E0020}-\u{E007E}]+\u{E007F}|[\u{1F1E6}-\u{1F1FF}]{2}|[0-9#*]\uFE0F?\u20E3`;
const emojiSequence = new RegExp(`^(?:${standaloneElement}|${joinableElement}(?:\\u200D${joinableElement})*)$`, "u");
export function emojiError(value: string): "invalid" | "too_long" | null {
  if (new TextEncoder().encode(value).length > 32) return "too_long";
  // A newer Segmenter may split Unicode-15 pictographs joined by U+200D (♡‍🔥).
  // The pinned, fully anchored backend grammar is authoritative for those ZWJ
  // sequences; adjacent, unjoined emoji still fail that grammar.
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
const testimonialItem = z.object({ quote: text(400), name: text(80), role: text(80), photo: mediaRefSchema, consent: z.boolean() }).strict();
export const testimonialsBlockSchema = z.object({ ...common, type: z.literal("testimonials"), variant: z.enum(["cards", "quote"]), content: z.object({ items: z.array(testimonialItem).max(6) }).strict() }).strict();
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
type BlockEnvelope = { id: string; type: string; hidden: boolean };
const draftInvariants = (draft: { blocks: BlockEnvelope[] }, ctx: z.RefinementCtx) => {
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

function complete(block: SiteBlock | SiteBlockV2): boolean {
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
    case "team": return block.content.items.length >= 1 && block.content.items.every(item => present(item.name) && item.consent === true);
    case "logos": return block.content.items.length >= 1 && block.content.items.every(item => present(item.name) && item.image !== null);
    case "areas": case "talent_cta": return present(block.content.title);
  }
}

function baseIssues(draft: { slug: string | null; blocks: (SiteBlock | SiteBlockV2)[] }): PublishIssue[] {
  const issues: PublishIssue[] = [];
  if (!present(draft.slug)) issues.push({ code: "slug_missing", field: "slug" });
  draft.blocks.forEach((block, index) => {
    if (!block.hidden && !complete(block)) issues.push({ code: block.type === "hero" ? "hero_title_missing" : "block_incomplete", field: `blocks[${index}]` });
  });
  if (!draft.blocks.some(block => !block.hidden && block.type !== "hero" && block.type !== "jobs")) issues.push({ code: "no_content_block", field: null });
  return issues;
}
function companyIssues(company: { name: string | null; logo_url: string | null }): PublishIssue[] {
  const issues: PublishIssue[] = [];
  if (!present(company.logo_url)) issues.push({ code: "company_logo_missing", field: null });
  if (!present(company.name)) issues.push({ code: "company_name_missing", field: null });
  return issues;
}
/** Publish checks supplement save validation; callers pass a parsed draft. */
export function publishIssues(draft: SiteDraft, company: { name: string | null; logo_url: string | null }): PublishIssue[] {
  return [...baseIssues(draft), ...companyIssues(company)];
}

// ---------------------------------------------------------------------------
// Sections v2, slice A (odd/tasks/careers-site-sections-v2-contract.md).
// Additive: the legacy schemas above stay byte-identical so today's editor and
// presentation are untouched; `siteDraftPayloadSchema` is the only write path
// that may emit these keys, and only when SECTIONS_V2_ENABLED.
// ---------------------------------------------------------------------------

export const SECTION_BACKGROUNDS = ["default", "tint", "brand", "image"] as const;
export const SECTION_SPACINGS = ["compact", "airy"] as const;
export const SECTION_ALIGNS = ["center", "start"] as const;
export const SECTION_OVERLAYS = ["soft", "medium", "strong"] as const;
export type SectionStyle = {
  background: (typeof SECTION_BACKGROUNDS)[number]; spacing: (typeof SECTION_SPACINGS)[number];
  align: (typeof SECTION_ALIGNS)[number]; overlay: (typeof SECTION_OVERLAYS)[number] | null; image: z.infer<typeof mediaRefSchema>;
};
/** Contract defaults for a missing `style` (or missing style keys). */
export const DEFAULT_SECTION_STYLE: Readonly<SectionStyle> = Object.freeze({ background: "default", spacing: "airy", align: "start", overlay: null, image: null });
const wireIssue = (ctx: z.RefinementCtx, path: (string | number)[], code: "required" | "not_allowed" | "invalid" | "duplicate") =>
  ctx.addIssue({ code: "custom", path, message: code, params: { wireCode: code } });
/** §2.3: `null` is accepted and dropped (= absent), so it takes the absent default. */
const nullAsAbsent = <T extends z.ZodTypeAny>(schema: T) => z.preprocess(value => value === null ? undefined : value, schema);
/** Curated per-block style (S3): overlay and image only with an image background, which then needs its image. */
const sectionStyleObject = z.object({
  background: z.enum(SECTION_BACKGROUNDS).default(DEFAULT_SECTION_STYLE.background),
  spacing: z.enum(SECTION_SPACINGS).default(DEFAULT_SECTION_STYLE.spacing),
  align: z.enum(SECTION_ALIGNS).default(DEFAULT_SECTION_STYLE.align),
  overlay: z.enum(SECTION_OVERLAYS).nullable().default(null),
  image: mediaRefSchema.default(null),
}).strict().superRefine((style, ctx) => {
  // A missing image is a publish issue (style_image_missing), never a save error: the
  // person can pick "Imagen" before uploading it.
  if (style.background === "image") return;
  if (style.overlay !== null) wireIssue(ctx, ["overlay"], "not_allowed");
  if (style.image !== null) wireIssue(ctx, ["image"], "not_allowed");
}).default(() => ({ ...DEFAULT_SECTION_STYLE }));
export const sectionStyleSchema = nullAsAbsent(sectionStyleObject);
const styled = { style: sectionStyleSchema };

/** Contract defaults for hero keys missing on read: the buttons (null target = first block after
 * the hero) and, since slice B, `background_video` (null = no video). Templates spread it whole. */
export const HERO_BUTTON_DEFAULTS = Object.freeze({ primary_label: "Ver vacantes", secondary_visible: true, secondary_label: "Conoce la empresa", secondary_target: null, background_video: null });
export const HERO_COLLAGE_MAX = 3;
/** Publishing a collage needs at least this many images (contract only caps it at 3). */
export const HERO_COLLAGE_MIN_TO_PUBLISH = 2;
const heroContentV2 = heroBlockSchema.shape.content.extend({
  images: nullAsAbsent(z.array(z.object({ media_id: z.string().uuid() }).strict()).max(HERO_COLLAGE_MAX).default(() => [])),
  primary_label: text(24).default(HERO_BUTTON_DEFAULTS.primary_label),
  secondary_visible: z.boolean().default(HERO_BUTTON_DEFAULTS.secondary_visible),
  secondary_label: text(24).default(HERO_BUTTON_DEFAULTS.secondary_label),
  // Any case on the wire, stored lower-case (§2.3).
  secondary_target: z.string().uuid().transform(id => id.toLowerCase()).nullable().default(HERO_BUTTON_DEFAULTS.secondary_target),
  // Slice B: the «Fondo en movimiento» MP4 (media kind `hero_video`); missing and null both mean none.
  background_video: mediaRefSchema.default(HERO_BUTTON_DEFAULTS.background_video),
});
export const heroBlockSchemaV2 = heroBlockSchema.extend({ variant: z.enum(["photo", "split", "centered", "background_loop", "photo_jobs", "collage"]), content: heroContentV2, ...styled });
const decoratedVariants = ["bento", "big_icons"] as const;
export const valuesBlockSchemaV2 = valuesBlockSchema.extend({ variant: z.enum(["grid", "list", ...decoratedVariants]), ...styled });
export const benefitsBlockSchemaV2 = benefitsBlockSchema.extend({ variant: z.enum(["grid", "compact", ...decoratedVariants]), ...styled });
export const statsBlockSchemaV2 = statsBlockSchema.extend({ variant: z.enum(["row", "cards", "brand_band"]), ...styled });
export const galleryBlockSchemaV2 = galleryBlockSchema.extend({ variant: z.enum(["grid", "mosaic", "carousel", "photo_strip"]), ...styled });
/** WHATWG URL drops a scheme's default port (":443"); the backend rejects any explicit port. */
function hasExplicitPort(value: string): boolean {
  const authority = /^[a-z][a-z\d+.-]*:\/\/([^/?#\\]*)/i.exec(value.trim())?.[1] ?? "";
  const host = authority.slice(authority.lastIndexOf("@") + 1);
  return /:\d+$/.test(host.startsWith("[") ? host.slice(host.indexOf("]") + 1) : host);
}
/** Stored as the URL the company pasted; accepted only when the existing YouTube/Vimeo parser recognizes it (no port, even :443). */
const testimonialVideoUrl = text(500).refine(value => value === null || (parseVideoUrl(value) !== null && !hasExplicitPort(value)), { message: "invalid", params: { wireCode: "invalid" } });
export const testimonialsBlockSchemaV2 = testimonialsBlockSchema.extend({
  variant: z.enum(["cards", "quote", "carousel"]),
  content: testimonialsBlockSchema.shape.content.extend({ items: z.array(testimonialItem.extend({ video_url: testimonialVideoUrl.default(null) })).max(6) }),
  ...styled,
});
// New block types are normalized like every other block (§2.3): missing strings and
// media refs → null, missing lists → []. Consent and override choices stay explicit.
const str = (max: number) => text(max).default(null);
const ref = mediaRefSchema.default(null);
const list = <T extends z.ZodTypeAny>(schema: z.ZodArray<T>) => nullAsAbsent(schema.default(() => []));
export const teamBlockSchema = z.object({ ...common, type: z.literal("team"), variant: z.enum(["grid", "portraits"]), content: z.object({
  title: str(80), intro: str(200),
  items: list(z.array(z.object({ name: str(80), role: str(80), photo: ref, consent: z.boolean() }).strict()).max(12)),
}).strict(), ...styled }).strict();
export const logosBlockSchema = z.object({ ...common, type: z.literal("logos"), variant: z.enum(["strip", "grid"]), content: z.object({
  title: str(80),
  items: list(z.array(z.object({ name: str(80), image: ref, caption: str(80) }).strict()).max(12)),
}).strict(), ...styled }).strict();
export const areaOverrideSchema = z.object({ key: z.enum(PROFESSIONAL_AREAS), icon: iconSchema.nullable().default(null), photo: ref }).strict().superRefine((override, ctx) => {
  if (override.icon === null && override.photo === null) wireIssue(ctx, ["icon"], "required");
  if (override.icon !== null && override.photo !== null) wireIssue(ctx, ["photo"], "not_allowed");
});
export const areasBlockSchema = z.object({ ...common, type: z.literal("areas"), variant: z.enum(["icon_cards", "photo_cards"]), content: z.object({
  title: str(80), intro: str(200),
  overrides: list(z.array(areaOverrideSchema).max(PROFESSIONAL_AREAS.length)).superRefine((overrides, ctx) => {
    const seen = new Set<string>();
    overrides.forEach((override, index) => {
      if (seen.has(override.key)) wireIssue(ctx, [index, "key"], "duplicate");
      seen.add(override.key);
    });
  }),
}).strict(), ...styled }).strict();
export const talentCtaBlockSchema = z.object({ ...common, type: z.literal("talent_cta"), variant: z.enum(["banner", "split"]), content: z.object({
  title: str(80), text: str(240), button_label: str(24),
}).strict(), ...styled }).strict();

const [storyV2, processV2, videoV2, officesV2, jobsV2, faqV2, closingV2] = [
  storyBlockSchema.extend(styled), processBlockSchema.extend(styled), videoBlockSchema.extend(styled), officesBlockSchema.extend(styled),
  jobsBlockSchema.extend(styled), faqBlockSchema.extend(styled), closingBlockSchema.extend(styled),
] as const;
export const NEW_BLOCK_TYPES = ["team", "logos", "areas", "talent_cta"] as const;
export const blockSchemaV2 = z.discriminatedUnion("type", [heroBlockSchemaV2, storyV2, valuesBlockSchemaV2, benefitsBlockSchemaV2, statsBlockSchemaV2, processV2, galleryBlockSchemaV2, testimonialsBlockSchemaV2, videoV2, officesV2, jobsV2, faqV2, closingV2, teamBlockSchema, logosBlockSchema, areasBlockSchema, talentCtaBlockSchema]);
export type SiteBlockV2 = z.infer<typeof blockSchemaV2>;
export type BlockTypeV2 = SiteBlockV2["type"];

const heroTargetInvariant = (draft: { blocks: SiteBlockV2[] }, ctx: z.RefinementCtx) => {
  const ids = new Set(draft.blocks.map(block => block.id));
  draft.blocks.forEach((block, index) => {
    const target = block.type === "hero" ? block.content.secondary_target : null;
    if (target !== null && (target === block.id || !ids.has(target))) {
      wireIssue(ctx, ["blocks", index, "content", "secondary_target"], "invalid");
    }
  });
};
const draftInvariantsV2 = (draft: { blocks: SiteBlockV2[] }, ctx: z.RefinementCtx) => { draftInvariants(draft, ctx); heroTargetInvariant(draft, ctx); };
/** Full slice A write document (always emits `style` and the hero button keys). */
export const siteDraftSchemaV2 = siteDraftObject.extend({ blocks: z.array(blockSchemaV2).min(2).max(30) }).superRefine(draftInvariantsV2);
export type SiteDraftV2 = z.infer<typeof siteDraftSchemaV2>;
const storedValuesV2 = valuesBlockSchemaV2.extend({ content: storedValues.shape.content });
const storedBenefitsV2 = benefitsBlockSchemaV2.extend({ content: storedBenefits.shape.content });
const storedBlockV2 = z.discriminatedUnion("type", [heroBlockSchemaV2, storyV2, storedValuesV2, storedBenefitsV2, statsBlockSchemaV2, processV2, galleryBlockSchemaV2, testimonialsBlockSchemaV2, videoV2, officesV2, jobsV2, faqV2, closingV2, teamBlockSchema, logosBlockSchema, areasBlockSchema, talentCtaBlockSchema]);
/** §2.3: a stored target that no longer names another block (deleted, or hidden in the public projection) reads as null. */
function dropDanglingTargets<Draft extends { blocks: SiteBlockV2[] }>(draft: Draft): Draft {
  const ids = new Set(draft.blocks.map(block => block.id));
  return { ...draft, blocks: draft.blocks.map(block => {
    if (block.type !== "hero") return block;
    const target = block.content.secondary_target;
    return target === null || (target !== block.id && ids.has(target)) ? block : { ...block, content: { ...block.content, secondary_target: null } };
  }) };
}
/** Read: accepts documents without any slice A key and normalizes them to the contract defaults. */
export const siteDraftReadSchemaV2 = siteDraftObject.extend({ blocks: z.array(storedBlockV2).min(2).max(30) }).superRefine(draftInvariants).transform(dropDanglingTargets);

const LEGACY_VARIANTS = new Map<string, readonly string[]>(blockSchema.options.map(option => [option.shape.type.value, option.shape.variant.options]));
const sameValue = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
/** Drops slice A keys that still hold their defaults; anything else cannot be expressed in v1 and is rejected, never silently lost. */
function toLegacyDraft(draft: SiteDraftV2, ctx: z.RefinementCtx): SiteDraft {
  let valid = true;
  const reject = (path: (string | number)[]) => { valid = false; wireIssue(ctx, path, "not_allowed"); };
  const blocks = draft.blocks.map((block, index) => {
    const variants = LEGACY_VARIANTS.get(block.type);
    if (!variants) { reject(["blocks", index, "type"]); return block; }
    if (!variants.includes(block.variant)) reject(["blocks", index, "variant"]);
    const { style, ...envelope } = block;
    if (!sameValue(style, DEFAULT_SECTION_STYLE)) reject(["blocks", index, "style"]);
    if (envelope.type === "hero") {
      const { images, primary_label, secondary_visible, secondary_label, secondary_target, background_video, ...content } = envelope.content;
      if (images.length > 0) reject(["blocks", index, "content", "images"]);
      if (background_video !== null) reject(["blocks", index, "content", "background_video"]);
      const buttons = { primary_label, secondary_visible, secondary_label, secondary_target };
      for (const key of Object.keys(buttons) as (keyof typeof buttons)[]) if (buttons[key] !== HERO_BUTTON_DEFAULTS[key]) reject(["blocks", index, "content", key]);
      return { ...envelope, content };
    }
    if (envelope.type === "testimonials") {
      return { ...envelope, content: { ...envelope.content, items: envelope.content.items.map(({ video_url, ...item }, itemIndex) => {
        if (video_url !== null) reject(["blocks", index, "content", "items", itemIndex, "video_url"]);
        return item;
      }) } };
    }
    return envelope;
  });
  return valid ? { ...draft, blocks: blocks as SiteDraft["blocks"] } : z.NEVER;
}
/** Slice B: a null `background_video` is not sent (missing ≡ null on the backend), so the v2 body
 * only changes once a video is actually set — saves keep working against a backend without slice B. */
function omitEmptyHeroVideo(draft: SiteDraftV2): SiteDraftV2 {
  return { ...draft, blocks: draft.blocks.map(block => {
    if (block.type !== "hero" || block.content.background_video !== null) return block;
    const { background_video: _none, ...content } = block.content; void _none;
    return { ...block, content: content as typeof block.content };
  }) };
}
export type SiteDraftPayload = SiteDraft | SiteDraftV2;
/** The draft PUT body for a v2 (or legacy) editor draft; flag off ⇒ exactly today's v1 document. */
export function createSiteDraftPayloadSchema(enabled: boolean): z.ZodType<SiteDraftPayload, z.ZodTypeDef, unknown> {
  return enabled ? siteDraftSchemaV2.transform(omitEmptyHeroVideo) : siteDraftSchemaV2.transform(toLegacyDraft);
}
export const siteDraftPayloadSchema = createSiteDraftPayloadSchema(SECTIONS_V2_ENABLED);

/** Slice B (backend-confirmed): «Fondo en movimiento» publishes only with its background video AND
 * the cover as poster; either one missing is a single `hero_video_missing` on the block. */
export const HERO_VIDEO_ISSUE = Object.freeze({ code: "hero_video_missing", field: (index: number) => `blocks[${index}]` } as const);
export type PublishIssueV2 = PublishIssue | {
  /** Codes agreed with the backend session for slice A. */
  code: "hero_video_missing" | "secondary_target_hidden" | "hero_collage_images_missing" | "style_image_missing";
  field: string;
};
/** publishIssues plus the slice A rules, in the §2.3 order; callers pass a parsed v2 draft. */
export function publishIssuesV2(draft: SiteDraftV2, company: { name: string | null; logo_url: string | null }): PublishIssueV2[] {
  const issues: PublishIssueV2[] = [];
  if (!present(draft.slug)) issues.push({ code: "slug_missing", field: "slug" });
  const visible = new Map(draft.blocks.map(block => [block.id, !block.hidden]));
  draft.blocks.forEach((block, index) => {
    if (block.hidden) return;
    const field = `blocks[${index}]`;
    // Per block: hero_title_missing, hero_video_missing, hero_collage_images_missing,
    // secondary_target_hidden; other blocks block_incomplete; then style_image_missing.
    if (block.type === "hero") {
      if (!complete(block)) issues.push({ code: "hero_title_missing", field });
      if (block.variant === "background_loop" && (block.content.background_video === null || block.content.cover === null)) issues.push({ code: HERO_VIDEO_ISSUE.code, field: HERO_VIDEO_ISSUE.field(index) });
      if (block.variant === "collage" && block.content.images.length < HERO_COLLAGE_MIN_TO_PUBLISH) issues.push({ code: "hero_collage_images_missing", field });
      const target = block.content.secondary_target;
      if (block.content.secondary_visible && target !== null && visible.get(target) === false) issues.push({ code: "secondary_target_hidden", field: `${field}.content.secondary_target` });
    } else if (!complete(block)) issues.push({ code: "block_incomplete", field });
    if (block.style.background === "image" && block.style.image === null) issues.push({ code: "style_image_missing", field: `${field}.style.image` });
  });
  if (!draft.blocks.some(block => !block.hidden && block.type !== "hero" && block.type !== "jobs")) issues.push({ code: "no_content_block", field: null });
  return [...issues, ...companyIssues(company)];
}
