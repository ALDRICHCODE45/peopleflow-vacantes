"use client";
import { useEffect, useSyncExternalStore } from "react";
import { languageCatalogSchema, type LanguageCatalog } from "./model";

type Snapshot = { status: "idle" | "loading" | "success" | "error"; data?: LanguageCatalog };
const idle: Snapshot = { status: "idle" };
let snapshot = idle;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
function publish(next: Snapshot) { snapshot = next; listeners.forEach(listener => listener()); }
// Public reference data only. Retain failures as well as successes; retry is explicit.
async function load(retry = false) {
  if (snapshot.status !== "idle" && !(retry && snapshot.status === "error")) return;
  publish({ status: "loading" });
  try {
    const response = await fetch("/api/catalogs/languages", { method: "GET", credentials: "omit", signal: AbortSignal.timeout(15_000) });
    const parsed = languageCatalogSchema.safeParse(await response.json());
    publish(response.status === 200 && parsed.success ? { status: "success", data: parsed.data } : { status: "error" });
  } catch { publish({ status: "error" }); }
}
export function useLanguageCatalog() {
  const value = useSyncExternalStore(subscribe, () => snapshot, () => idle);
  useEffect(() => { void load(); }, []);
  return { ...value, retry: () => { void load(true); } };
}
