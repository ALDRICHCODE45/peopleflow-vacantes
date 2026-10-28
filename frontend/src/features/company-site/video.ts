import { z } from "zod";

export const videoSchema = z.discriminatedUnion("provider", [
  z.object({ provider: z.literal("youtube"), video_id: z.string().trim().regex(/^[A-Za-z0-9_-]{11}$/) }).strict(),
  z.object({ provider: z.literal("vimeo"), video_id: z.string().trim().regex(/^\d{1,12}$/) }).strict(),
]);
export type SiteVideo = z.infer<typeof videoSchema>;

/** Parse known share/embed paths, never an arbitrary host or iframe snippet. */
export function parseVideoUrl(input: string): SiteVideo | null {
  let url: URL;
  try { url = new URL(input.trim()); } catch { return null; }
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.port) return null;
  const host = url.hostname;
  const path = url.pathname;
  let candidate: unknown = null;
  if (host === "youtube.com" || host === "www.youtube.com") {
    const match = /^\/(?:embed|shorts)\/([^/]+)\/?$/.exec(path);
    candidate = { provider: "youtube", video_id: path === "/watch" ? url.searchParams.get("v") : match?.[1] };
  } else if (host === "youtu.be") {
    candidate = { provider: "youtube", video_id: /^\/([^/]+)\/?$/.exec(path)?.[1] };
  } else if (host === "vimeo.com" || host === "www.vimeo.com") {
    candidate = { provider: "vimeo", video_id: /^\/(\d+)\/?$/.exec(path)?.[1] };
  } else if (host === "player.vimeo.com") {
    candidate = { provider: "vimeo", video_id: /^\/video\/(\d+)\/?$/.exec(path)?.[1] };
  }
  const parsed = videoSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}
