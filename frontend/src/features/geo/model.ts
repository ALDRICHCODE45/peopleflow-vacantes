import { z } from "zod";

export const countryCodeSchema = z.string().regex(/^[A-Z]{2}$/);
export const stateCodeSchema = z.string().regex(/^\d{2}$/);
export const municipalityCodeSchema = z.string().regex(/^\d{5}$/);
export const postalCodeSchema = z.string().regex(/^\d{5}$/);
const reference = (id: z.ZodString) => z.object({ id, name: z.string().min(1) }).strict();
export const countryReferenceSchema = reference(countryCodeSchema);
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
/** Expanded read values are display-only; write schemas never accept names. */
export const locationReadSchema = z.object({
  country: countryReferenceSchema,
  state: stateSchema.nullable(),
  municipality: municipalitySchema.nullable(),
  postal_code: postalCodeSchema.nullable(),
  label: z.string(),
}).strict().nullable();
export const locationWriteSchema = z.object({
  country: countryCodeSchema,
  state: stateCodeSchema.optional(),
  municipality: municipalityCodeSchema.optional(),
  postal_code: postalCodeSchema.optional(),
}).strict().nullable();
const countryCodes = z.array(countryCodeSchema).min(1).max(50).refine(codes => new Set(codes).size === codes.length, "duplicate");
const countryReferences = z.array(countryReferenceSchema).min(1).max(50).refine(countries => new Set(countries.map(country => country.id)).size === countries.length, "duplicate");
export const remoteScopeReadSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("anywhere") }).strict(),
  z.object({ kind: z.literal("countries"), countries: countryReferences }).strict(),
]).nullable();
export const remoteScopeWriteSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("anywhere") }).strict(),
  z.object({ kind: z.literal("countries"), countries: countryCodes }).strict(),
]).nullable();
export type LocationRead = z.infer<typeof locationReadSchema>;
export type LocationWrite = z.infer<typeof locationWriteSchema>;
export type RemoteScopeRead = z.infer<typeof remoteScopeReadSchema>;
export type RemoteScopeWrite = z.infer<typeof remoteScopeWriteSchema>;

export function locationReadToValue(location: LocationRead): LocationValue {
  return { country: location?.country.id ?? null, state: location?.state?.id ?? null, municipality: location?.municipality?.id ?? null, postal_code: location?.postal_code ?? null };
}
export function locationValueToWrite(value: LocationValue): LocationWrite {
  if (value.country === null) return null;
  return { country: value.country, ...(value.state === null ? {} : { state: value.state }), ...(value.municipality === null ? {} : { municipality: value.municipality }), ...(value.postal_code === null ? {} : { postal_code: value.postal_code }) };
}
export function remoteScopeReadToWrite(scope: RemoteScopeRead): RemoteScopeWrite {
  if (scope === null || scope.kind === "anywhere") return scope;
  return { kind: "countries", countries: scope.countries.map(country => country.id) };
}
export const locationErrorMessages = {
  required: "Completa este dato.",
  unknown: "Elige una opción de la lista.",
  mismatch: "El código postal no corresponde al municipio.",
  not_allowed: "Este dato no se puede guardar aquí.",
} as const;
export const remoteScopeErrorMessages = {
  empty: "Elige al menos un país.",
  duplicate: "Quita los países repetidos.",
  too_many: "Puedes elegir hasta 50 países.",
  unknown_country: "Elige países de la lista.",
} as const;
export type LocationIssue = { field: keyof LocationValue; reason: keyof typeof locationErrorMessages };
export type RemoteScopeIssue = { field: "countries"; index?: number; reason: keyof typeof remoteScopeErrorMessages };
export type GeographyErrors = { location: LocationIssue[]; remoteScope: RemoteScopeIssue[] };
const geographyEnvelopeSchema = z.discriminatedUnion("code", [
  z.object({ code: z.literal("invalid_location"), error: z.string(), details: z.array(z.object({ field: z.string().regex(/^fields\.location\.(country|state|municipality|postal_code)$/), reason: z.enum(["required", "unknown", "mismatch", "not_allowed"]) }).strict()).min(1) }).strict(),
  z.object({ code: z.literal("invalid_remote_scope"), error: z.string(), details: z.array(z.object({ field: z.string().regex(/^fields\.remote_scope\.countries(?:\[\d+\])?$/), reason: z.enum(["empty", "duplicate", "too_many", "unknown_country"]) }).strict()).min(1) }).strict(),
]);
/** Only the explicit 422 extension admits details; unknown envelopes fail closed. */
export function parseGeographyErrors(status: number | undefined, body: unknown): GeographyErrors | null {
  if (status !== 422) return null;
  const parsed = geographyEnvelopeSchema.safeParse(body);
  if (!parsed.success) return null;
  const envelope = parsed.data;
  if (envelope.code === "invalid_location") return { location: envelope.details.map(issue => ({ field: issue.field.split(".").at(-1) as keyof LocationValue, reason: issue.reason })), remoteScope: [] };
  return { location: [], remoteScope: envelope.details.map(issue => {
    const index = /\[(\d+)\]$/.exec(issue.field);
    return { field: "countries", ...(index ? { index: Number(index[1]) } : {}), reason: issue.reason };
  }) };
}

export const failureStatus: Record<GeoFailure, number> = { country_not_found: 404, state_not_found: 404, postal_code_not_found: 404, invalid_postal_code: 400, invalid_request: 400, no_response: 503, unrecognized_response: 502 };
