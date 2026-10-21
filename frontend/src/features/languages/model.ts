import { z } from "zod";

// Codes are opaque catalog identifiers (including local-use INALI groupings).
export const languageCatalogSchema = z.object({ items: z.array(z.object({ code: z.string().min(1), name: z.string().min(1) }).strict()).superRefine((items, ctx) => {
  const seen = new Set<string>();
  items.forEach((item, index) => { if (seen.has(item.code)) ctx.addIssue({ code: "custom", path: [index, "code"], message: "Duplicate catalog code" }); seen.add(item.code); });
}) }).strict();
export type LanguageCatalog = z.infer<typeof languageCatalogSchema>;
export type LanguageOption = LanguageCatalog["items"][number];
