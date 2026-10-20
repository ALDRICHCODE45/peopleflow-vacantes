"use server";
import { z } from "zod";
import { getActionAccessToken } from "@/lib/auth/action-session";
import { getProfile, getProfileLanguages, putProfile, putProfileLanguages } from "./profile-client";
import type { ProfileFailure, ProfileLanguages, ProfileRead, ProfileResult } from "./profile-api";
import { saveProfileParts, type ProfileSaveOutcome } from "./profile-save";

async function safe<T>(run: () => Promise<ProfileResult<T>>): Promise<ProfileResult<T>> {
  try { return await run(); }
  catch { return { ok: false, reason: "no_response", reference: {} }; }
}
const unauthenticated: ProfileFailure = { ok: false, reason: "unauthenticated", reference: {} };

/** Loading and Comprobar share this read-only action; neither performs a PUT. */
export async function loadProfileAction(): Promise<ProfileResult<{ profile: ProfileRead; languages: ProfileLanguages }>> {
  return safe(async () => {
    const token = await getActionAccessToken();
    if (!token) return unauthenticated;
    const [profile, languages] = await Promise.all([
      safe(() => getProfile({ token })), safe(() => getProfileLanguages({ token })),
    ]);
    if (!profile.ok) return profile;
    if (!languages.ok) return languages;
    return { ok: true, data: { profile: profile.data, languages: languages.data } };
  });
}
export async function saveProfileAction(raw: unknown): Promise<ProfileSaveOutcome> {
  const input = z.object({ profile: z.unknown().optional(), languages: z.unknown().optional() }).strict().safeParse(raw);
  if (!input.success) return { kind: "invalid", issues: [{ path: "profile", message: "Revisa los datos del perfil." }] };
  let token: string | null;
  try { token = await getActionAccessToken(); }
  catch { return { kind: "failed", part: "profile", failure: unauthenticated }; }
  if (!token) return { kind: "failed", part: "profile", failure: unauthenticated };
  const accessToken = token;
  return saveProfileParts(input.data, {
    putProfile: body => safe(() => putProfile({ token: accessToken, body })),
    putLanguages: body => safe(() => putProfileLanguages({ token: accessToken, body })),
  });
}
