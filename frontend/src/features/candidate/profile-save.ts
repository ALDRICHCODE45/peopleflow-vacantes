import { languagesSchema, profileWriteSchema, type ProfileFailure, type ProfileLanguages, type ProfileRead, type ProfileResult, type ProfileWrite } from "./profile-api";

export type ProfileSavePort = {
  putProfile: (body: ProfileWrite) => Promise<ProfileResult<ProfileRead>>;
  putLanguages: (body: ProfileLanguages) => Promise<ProfileResult<ProfileLanguages>>;
};
export type ProfileSaveOutcome =
  | { kind: "unchanged" }
  | { kind: "invalid"; issues: { path: string; message: string }[] }
  | { kind: "saved"; profile?: ProfileRead; languages?: ProfileLanguages }
  | { kind: "failed"; part: "profile" | "languages"; failure: ProfileFailure }
  | { kind: "partial"; profile: ProfileRead; failure: ProfileFailure }
  | { kind: "uncertain"; part: "profile" | "languages"; profile?: ProfileRead; failure: ProfileFailure };
export const uncertainProfileFailure = (failure: ProfileFailure): boolean =>
  ["no_response", "server_error", "unrecognized_response"].includes(failure.reason);

/** The caller omits unchanged blocks, never individual fields from a changed
 * profile: PUT is full replacement. Validate both blocks before the first write.
 * Only confirmed responses become baselines; this function never retries. */
export async function saveProfileParts(input: { profile?: unknown; languages?: unknown }, api: ProfileSavePort): Promise<ProfileSaveOutcome> {
  const profile = input.profile === undefined ? undefined : profileWriteSchema.safeParse(input.profile);
  const languages = input.languages === undefined ? undefined : languagesSchema.safeParse(input.languages);
  const issues = [
    ...(profile && !profile.success ? profile.error.issues.map(issue => ({ path: issue.path.join("."), message: "Revisa este dato." })) : []),
    ...(languages && !languages.success ? languages.error.issues.map(issue => ({ path: issue.path.join("."), message: "Revisa el nombre y el nivel del idioma." })) : []),
  ];
  if (issues.length) return { kind: "invalid", issues };
  if (!profile && !languages) return { kind: "unchanged" };
  let savedProfile: ProfileRead | undefined;
  if (profile?.success) {
    const result = await api.putProfile(profile.data);
    if (!result.ok) return { kind: uncertainProfileFailure(result) ? "uncertain" : "failed", part: "profile", failure: result };
    savedProfile = result.data;
  }
  const saved = savedProfile ? { profile: savedProfile } : {};
  if (languages?.success) {
    const result = await api.putLanguages(languages.data);
    if (!result.ok) {
      if (uncertainProfileFailure(result)) return { kind: "uncertain", part: "languages", ...saved, failure: result };
      return savedProfile ? { kind: "partial", profile: savedProfile, failure: result } : { kind: "failed", part: "languages", failure: result };
    }
    return { kind: "saved", ...saved, languages: result.data };
  }
  return { kind: "saved", ...saved };
}
