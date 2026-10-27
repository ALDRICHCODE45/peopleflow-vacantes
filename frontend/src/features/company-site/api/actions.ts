"use server";

import { getActionAccessToken } from "@/lib/auth/action-session";
import { getSite, putDraft, publishSite, unpublishSite, slugAvailability, type SaveInput } from "./client";
import type { AvailabilityResult, Failure, SiteResult } from "./model";

async function authenticated<T>(call: (token: string) => Promise<T>): Promise<T | Failure> {
  try {
    const token = await getActionAccessToken();
    if (!token?.trim()) return { kind: "unauthenticated" };
    return await call(token);
  } catch {
    // No implicit replay: a mutation might already have reached the backend.
    return { kind: "uncertain" };
  }
}
export async function loadSiteAction(): Promise<SiteResult> { return authenticated(getSite); }
export async function saveDraftAction(input: SaveInput): Promise<SiteResult> { return authenticated(token => putDraft(token, input)); }
export async function publishSiteAction(ifMatch: string): Promise<SiteResult> { return authenticated(token => publishSite(token, ifMatch)); }
export async function unpublishSiteAction(): Promise<SiteResult> { return authenticated(unpublishSite); }
export async function slugAvailabilityAction(slug: string): Promise<AvailabilityResult> { return authenticated(token => slugAvailability(token, slug)); }
