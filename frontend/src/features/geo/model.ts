import { z } from "zod";

export const countryCodeSchema = z.string().regex(/^[A-Z]{2}$/);
export const stateCodeSchema = z.string().regex(/^\d{2}$/);
export const municipalityCodeSchema = z.string().regex(/^\d{5}$/);
export const postalCodeSchema = z.string().regex(/^\d{5}$/);
const reference = (id: z.ZodString) => z.object({ id, name: z.string().min(1) }).strict();
const stateSchema = reference(stateCodeSchema);
const municipalitySchema = reference(municipalityCodeSchema);
export const countriesSchema = z.object({ items: z.array(reference(countryCodeSchema)) }).strict();
export const statesSchema = z.object({ items: z.array(stateSchema) }).strict();
export const municipalitiesSchema = z.object({ items: z.array(municipalitySchema) }).strict();
export const postalSchema = z.object({ postal_code: postalCodeSchema, matches: z.array(z.object({ state: stateSchema, municipality: municipalitySchema }).strict()) }).strict();
export type Catalog = z.infer<typeof countriesSchema>;
export type GeoReference = Catalog["items"][number];
export type PostalResult = z.infer<typeof postalSchema>;
export type LocationValue = { country: string | null; state: string | null; municipality: string | null; postal_code: string | null };
export type GeoFailure = "country_not_found" | "state_not_found" | "postal_code_not_found" | "invalid_postal_code" | "invalid_request" | "no_response" | "unrecognized_response";
export type GeoResult<T> = { ok: true; data: T } | { ok: false; error: GeoFailure };
export const errorEnvelopeSchema = z.object({ code: z.string(), error: z.string().optional() }).strict();
export function mapFailure(status?: number, body?: unknown): GeoFailure {
  if (status === undefined) return "no_response";
  const envelope = errorEnvelopeSchema.safeParse(body);
  const code = envelope.success ? envelope.data.code : undefined;
  if (status === 404 && (code === "country_not_found" || code === "state_not_found" || code === "postal_code_not_found")) return code;
  if (status === 400 && (code === "invalid_postal_code" || code === "invalid_request")) return code;
  if (status === 503 && code === "no_response") return code;
  return "unrecognized_response";
}
export const failureStatus: Record<GeoFailure, number> = { country_not_found: 404, state_not_found: 404, postal_code_not_found: 404, invalid_postal_code: 400, invalid_request: 400, no_response: 503, unrecognized_response: 502 };
