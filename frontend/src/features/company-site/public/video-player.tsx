"use client";
import { useState } from "react";
import { Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { SiteBlock } from "../model";

type Video = NonNullable<Extract<SiteBlock, { type: "video" }>["content"]["video"]>;
/** No third-party iframe, thumbnail or network request before explicit consent. */
export function VideoPlayer({ video, title }: { video: Video; title: string }) {
  const [playing, setPlaying] = useState(false);
  const src = video.provider === "youtube"
    ? `https://www.youtube-nocookie.com/embed/${video.video_id}`
    : `https://player.vimeo.com/video/${video.video_id}`;
  return playing
    ? <iframe className="aspect-video w-full rounded-xl border-0" src={src} title={title} allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture; fullscreen" allowFullScreen />
    // Media canvas rather than an empty content card; no external thumbnail request.
    : <div data-video-idle className="flex aspect-video min-w-0 flex-col items-center justify-center gap-4 rounded-xl bg-(--site-band)">
      <Button data-brand-surface="" size="icon" className="size-16 rounded-full" type="button" onClick={() => setPlaying(true)} aria-label={`Reproducir video: ${title}`}><Play aria-hidden="true" className="size-6 translate-x-0.5" /><span className="sr-only">Reproducir video</span></Button>
      <p className="text-center text-xs text-muted-foreground">{video.provider === "youtube" ? "YouTube" : "Vimeo"} · se carga al reproducir</p>
    </div>;
}
