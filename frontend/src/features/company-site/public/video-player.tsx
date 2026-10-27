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
    ? <iframe className="aspect-video w-full" src={src} title={title} allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture; fullscreen" allowFullScreen />
    : <div className="flex aspect-video items-center justify-center bg-muted"><Button className="min-h-10" type="button" onClick={() => setPlaying(true)} aria-label={`Reproducir video: ${title}`}><Play aria-hidden="true" data-icon="inline-start" />Reproducir video: {title}</Button></div>;
}
