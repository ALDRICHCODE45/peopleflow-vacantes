import "server-only";
import { z } from "zod";
import { requestJson } from "@/lib/api/server";
import { countriesSchema, statesSchema, municipalitiesSchema, postalSchema, stateCodeSchema, postalCodeSchema, errorEnvelopeSchema, mapFailure, type GeoResult } from "./model";

async function get<T>(path: string, schema: z.ZodType<T>): Promise<GeoResult<T>> {
  const { serverEnv } = await import("@/lib/env/server");
  const result = await requestJson(new URL(`/v2/geo/${path}`, serverEnv.apiBaseUrl).toString(), {
    method: "GET", expectedStatus: 200, redirect: "error", timeoutMs: serverEnv.apiTimeoutMs,
    decoder: value => schema.parse(value), errorDecoder: value => errorEnvelopeSchema.parse(value), maxErrorBodyBytes: 8192,
  });
  if (result.ok) return { ok: true, data: result.data };
  return { ok: false, error: result.error.kind === "invalid_response" ? "unrecognized_response" : mapFailure("status" in result.error ? result.error.status : undefined, result.envelope) };
}
export const getCountries = () => get("countries", countriesSchema);
export const getStates = () => get("countries/MX/states", statesSchema);
export const getMunicipalities = (state: string) => stateCodeSchema.safeParse(state).success
  ? get(`countries/MX/states/${state}/municipalities`, municipalitiesSchema)
  : Promise.resolve({ ok: false, error: "invalid_request" } as const);
export const getPostalCode = (cp: string) => postalCodeSchema.safeParse(cp).success
  ? get(`countries/MX/postal-codes/${cp}`, postalSchema)
  : Promise.resolve({ ok: false, error: "invalid_postal_code" } as const);
