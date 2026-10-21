import { z } from "zod";
import { CEFR_LEVELS } from "@/features/candidate/model";

export const REQUESTER_KINDS = ["internal_area", "client"] as const;
export const draftRequesterSchema = z.object({
  kind: z.enum(REQUESTER_KINDS),
  id: z.string().uuid().nullable(),
}).strict().nullable();

/** Opaque catalog identifiers: only the server can enforce membership. */
export const draftLanguageSchema = z.object({
  code: z.string().min(1),
  min_level: z.enum(CEFR_LEVELS),
}).strict();
export const draftLanguagesSchema = z.array(draftLanguageSchema).max(20).superRefine((items, context) => {
  const seen = new Set<string>();
  items.forEach((item, index) => {
    if (seen.has(item.code)) context.addIssue({ code: "custom", path: [index, "code"], message: "Este idioma ya está agregado." });
    seen.add(item.code);
  });
});
export const draftNestedFieldSchemas = { requester: draftRequesterSchema, languages: draftLanguagesSchema } as const;
export type DraftNestedField = keyof typeof draftNestedFieldSchemas;
export type DraftRequester = z.output<typeof draftRequesterSchema>;
export type DraftLanguage = z.output<typeof draftLanguagesSchema>[number];
