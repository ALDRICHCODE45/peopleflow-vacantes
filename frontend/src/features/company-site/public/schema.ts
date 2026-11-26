import { z } from "zod";
import { locationReadSchema } from "@/features/geo/model";
import { siteDraftReadSchema, siteDraftReadSchemaV2 } from "../model";
import { mediaSchema } from "../api/model";
import { validateSlug } from "../slug";

const slugSchema = z.string().refine(value => validateSlug(value) === null);
// Profile links are untrusted data, not executable browser protocols.
const linkSchema = z.string().url().refine(value => {
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password;
  } catch { return false; }
}).nullable();
const publicSiteEnvelope = z.object({
  company: z.object({
    id: z.string().uuid(), name: z.string().min(1), logo_url: linkSchema,
    description: z.string().nullable(), website: linkSchema, linkedin_url: linkSchema,
    instagram_url: linkSchema, facebook_url: linkSchema, twitter_url: linkSchema,
    location: locationReadSchema,
  }),
  // Reuse every existing block/theme rule; slug lives at the response root.
  site: z.unknown(), slug: slugSchema, published_at: z.string().datetime({ offset: true }),
  media: z.array(mediaSchema),
});
function withSite<Draft extends { slug: unknown }>(read: z.ZodType<Draft, z.ZodTypeDef, unknown>) {
  return publicSiteEnvelope.transform((value, ctx) => {
    const site = read.safeParse({ ...(typeof value.site === "object" && value.site !== null ? value.site : {}), slug: value.slug });
    if (!site.success) {
      ctx.addIssue({ code: "custom", path: ["site"], message: "Invalid published site" });
      return z.NEVER;
    }
    const { slug: _slug, ...document } = site.data;
    void _slug;
    return { ...value, site: document as Omit<Draft, "slug"> };
  });
}
export const publicSiteSchema = withSite(siteDraftReadSchema);
export type PublicSite = z.output<typeof publicSiteSchema>;
/** Sections v2 read: legacy documents normalize to the slice A defaults (style, hero buttons). */
export const publicSiteSchemaV2 = withSite(siteDraftReadSchemaV2);
export type PublicSiteV2 = z.output<typeof publicSiteSchemaV2>;
