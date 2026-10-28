/* eslint-disable @next/next/no-img-element -- Same-origin capability media proxy. */
import { cn } from "@/lib/utils";
import { mediaUrl } from "./media";

export function SiteMedia({ image, alt, className, eager = false }: { image: { media_id: string } | null; alt: string; className?: string; eager?: boolean }) {
  return image ? <img src={mediaUrl(image.media_id)} alt={alt} loading={eager ? "eager" : "lazy"} className={cn("w-full max-w-full rounded-xl object-cover", className)} /> : null;
}
