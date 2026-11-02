"use client";
import { QueryClient } from "@tanstack/react-query";
import type { Identity } from "@/features/identity/model";
import type { SavedJobIds } from "./model";

export const savedJobIdsKey = ["saved-jobs", "ids"] as const;
export const savedJobsKey = ["saved-jobs", "list"] as const;
// The existing identity boundary discards its subtree on account changes. A
// WeakMap also scopes caches to that identity lifetime, not a global candidate.
const clients = new WeakMap<Identity, QueryClient>();
export function savedJobsQueryClient(identity: Identity): QueryClient {
  let client = clients.get(identity);
  if (!client) {
    client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity, refetchOnWindowFocus: false, refetchOnReconnect: false } } });
    clients.set(identity, client);
  }
  return client;
}
/** The single confirmed-state writer, shared by islands and the T4 workspace. */
export function updateSavedJobIds(client: QueryClient, jobId: string, saved: boolean) {
  client.setQueryData<SavedJobIds>(savedJobIdsKey, current => current ? {
    job_ids: saved ? Array.from(new Set([...current.job_ids, jobId])) : current.job_ids.filter(id => id !== jobId),
  } : undefined);
  void client.invalidateQueries({ queryKey: savedJobsKey });
}
