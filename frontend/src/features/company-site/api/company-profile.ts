import "server-only";
import { z } from "zod";
import { locationReadSchema } from "@/features/geo/model";
import type { PublicSite } from "../public/schema";

const link = z.string().url().refine(value => {
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password;
  } catch { return false; }
}).nullish().transform(value => value ?? null);
// Strictly decode companyPublicResponse, then project only identity fields over
// the client boundary. Optional fields follow the backend's omitempty semantics.
export const companyProfileSchema = z.object({
  id: z.string().uuid(), name: z.string().trim().min(1), industry_id: z.string(), logo_url: link,
  description: z.string().nullish().transform(value => value ?? null), website: link,
  linkedin_url: link, instagram_url: link, facebook_url: link, twitter_url: link,
  location: locationReadSchema, size: z.string().nullish(), founded_year: z.number().int().nullish(), cover_image_url: link,
}).strict().transform(profile => ({
  id: profile.id, name: profile.name, logo_url: profile.logo_url, description: profile.description,
  website: profile.website, linkedin_url: profile.linkedin_url, instagram_url: profile.instagram_url,
  facebook_url: profile.facebook_url, twitter_url: profile.twitter_url, location: profile.location,
}));
export type CompanyProfileResult = { ok: true; company: PublicSite["company"] } | { ok: false };
