/** Opaque tokens have no contract-mandated encoding; preserve them as a single URL segment. */
export function assessmentTokenSegment(token: string): string | null {
  try {
    if (!token || /\s/.test(token) || token === "." || token === "..") return null;
    return encodeURIComponent(token);
  } catch { return null; }
}
/** Compose only from the frontend origin, never the API origin. Does not log or retain the token. */
export function candidateUrl(appOrigin: string, token: string): string {
  try {
    const url = new URL(appOrigin);
    const segment = assessmentTokenSegment(token);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || segment === null) throw new Error();
    return `${url.origin}/evaluacion/${segment}`;
  } catch { throw new Error("Invalid assessment link"); }
}
