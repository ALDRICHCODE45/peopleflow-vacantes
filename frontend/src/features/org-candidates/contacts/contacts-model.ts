import { z } from "zod";
import { orgCandidateIdentitySchema } from "../detail/detail-model";

export const CONTACTS_CHUNK_SIZE = 100;
export const CONTACTS_EXPORT_FAILURE = "No pudimos obtener el contacto de los candidatos. Intenta de nuevo.";
export const contactIdentityKey = (candidate: z.infer<typeof orgCandidateIdentitySchema>) => `${candidate.kind}:${candidate.id.toLowerCase()}`;
export const contactSelectionSchema = z.array(orgCandidateIdentitySchema).min(1)
 .refine(items => new Set(items.map(contactIdentityKey)).size === items.length, "duplicate");
export const contactsBodySchema = z.object({ candidates: contactSelectionSchema.refine(items => items.length <= CONTACTS_CHUNK_SIZE, "too_many") }).strict();
export const candidateContactSchema = orgCandidateIdentitySchema.extend({ email: z.string().nullable(), phone: z.string().nullable() }).strict();
export const contactsResponseSchema = z.object({ items: z.array(candidateContactSchema).max(CONTACTS_CHUNK_SIZE) }).strict();
export type CandidateContact = z.infer<typeof candidateContactSchema>;
export type ContactsResult = { ok: true; data: { items: CandidateContact[] } } | { ok: false };
