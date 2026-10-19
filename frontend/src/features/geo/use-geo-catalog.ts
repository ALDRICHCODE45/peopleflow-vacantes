"use client";
import { useCallback, useEffect, useSyncExternalStore } from "react";
import { z } from "zod";
import { countriesSchema, statesSchema, municipalitiesSchema, postalSchema, mapFailure, stateCodeSchema, postalCodeSchema, type GeoFailure } from "./model";

type Snapshot<T> = { status: "idle" | "loading" | "success" | "error"; data?: T; error?: GeoFailure };
type Entry<T> = { snapshot: Snapshot<T>; listeners: Set<() => void> };
const idle = { status: "idle" } as const;
// Anonymous reference data only. Pending and failed requests are retained too:
// remounting, focusing or reconnecting must not become an implicit retry.
const entries = new Map<string, Entry<unknown>>();
function entry<T>(key: string): Entry<T> {
  if (!entries.has(key)) entries.set(key, { snapshot: idle, listeners: new Set() });
  return entries.get(key)! as Entry<T>;
}
function publish<T>(target: Entry<T>, snapshot: Snapshot<T>) {
  target.snapshot = snapshot;
  target.listeners.forEach(listener => listener());
}
async function load<T>(key: string, schema: z.ZodType<T>, retry = false) {
  const target = entry<T>(key);
  if (target.snapshot.status !== "idle" && !(retry && target.snapshot.status === "error")) return;
  publish(target, { status: "loading" });
  try {
    const response = await fetch(`/api/geo/${key}`, { method: "GET", credentials: "omit", signal: AbortSignal.timeout(15_000) });
    let body: unknown;
    try { body = await response.json(); } catch { publish(target, { status: "error", error: "unrecognized_response" }); return; }
    if (response.status !== 200) { publish(target, { status: "error", error: mapFailure(response.status, body) }); return; }
    const decoded = schema.safeParse(body);
    publish(target, decoded.success ? { status: "success", data: decoded.data } : { status: "error", error: "unrecognized_response" });
  } catch { publish(target, { status: "error", error: "no_response" }); }
}
export function useGeoResource<T>(key: string | null, schema: z.ZodType<T>) {
  const subscribe = useCallback((listener: () => void) => {
    if (!key) return () => {};
    const target = entry<T>(key); target.listeners.add(listener);
    return () => { target.listeners.delete(listener); };
  }, [key]);
  const snapshot = useSyncExternalStore<Snapshot<T>>(subscribe, () => key ? entry<T>(key).snapshot : idle, () => idle);
  useEffect(() => { if (key) void load(key, schema); }, [key, schema]);
  return { ...snapshot, retry: () => { if (key) void load(key, schema, true); } };
}
export function useGeoCatalog(state: string | null, subdivisions = true) {
  const countries = useGeoResource("countries", countriesSchema);
  const states = useGeoResource(subdivisions ? "countries/mx/states" : null, statesSchema);
  const municipalities = useGeoResource(subdivisions && stateCodeSchema.safeParse(state).success ? `countries/mx/states/${state}/municipalities` : null, municipalitiesSchema);
  return { countries, states, municipalities, retry: () => { countries.retry(); states.retry(); municipalities.retry(); } };
}
export function useGeoPostalCode(cp: string | null) {
  return useGeoResource(postalCodeSchema.safeParse(cp).success ? `countries/mx/postal-codes/${cp}` : null, postalSchema);
}
