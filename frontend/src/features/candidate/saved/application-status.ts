"use client";
import { useQuery, type QueryClient } from "@tanstack/react-query";
import { loadApplicationsAction } from "@/features/candidate-applications/actions";
import type { ApplicationsPage, Result } from "@/features/candidate-applications/model";

type Application = ApplicationsPage["items"][number];
export type ApplicationBadge = { label: string; variant: "neutral" | "info" | "review" };
/** Same words and paint as the applications inbox status badge. */
export function applicationBadge(item: Application): ApplicationBadge {
  if (item.status === "closed") return { label: "Cerrada", variant: "neutral" };
  if (item.vacancy.state === "closed") return { label: "Vacante cerrada", variant: "neutral" };
  return item.status === "submitted" ? { label: "Enviada", variant: "info" } : { label: "En proceso", variant: "review" };
}

const PAGE = 50;
const MAX_PAGES = 4;
/**
 * The saved list carries only `{ id, applied_at }` per application; the status lives in the candidate applications list.
 * Read it page by page (read-only) until every wanted id is found, the list ends, or MAX_PAGES. A failure with nothing
 * found throws, so the rows fall back to «Te postulaste el …» and a later mount retries.
 */
async function join(ids: string[]): Promise<Map<string, ApplicationBadge>> {
  const wanted = new Set(ids);
  const found = new Map<string, ApplicationBadge>();
  let cursor: string | null = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    const result: Result<ApplicationsPage> | null = await loadApplicationsAction(cursor ? { limit: PAGE, cursor } : { limit: PAGE }).catch(() => null);
    if (!result?.ok) { if (found.size === 0) throw new Error("applications unavailable"); break; }
    for (const item of result.data.items) if (wanted.has(item.id)) found.set(item.id, applicationBadge(item));
    cursor = result.data.next_cursor;
    if (found.size === wanted.size || !cursor) break;
  }
  return found;
}

export function useApplicationStatuses(ids: string[], client: QueryClient) {
  const key = ids.slice().sort();
  const query = useQuery({ queryKey: ["saved-jobs", "application-status", key], queryFn: () => join(key), enabled: key.length > 0 }, client);
  return query.data;
}
