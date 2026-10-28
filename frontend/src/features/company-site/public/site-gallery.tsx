"use client";
import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { SiteBlock } from "../model";
import { SiteMedia } from "./site-media";

type Gallery = Extract<SiteBlock, { type: "gallery" }>;
/** No Carousel primitive is installed: semantic figures + installed Buttons, no autoplay. */
export function SiteGallery({ block }: { block: Gallery }) {
  const [active, setActive] = useState(0);
  const items = block.content.items.filter(item => item.image && item.alt);
  const move = (index: number) => setActive(Math.max(0, Math.min(items.length - 1, index)));
  const carousel = block.variant === "carousel";
  return <div data-layout={`gallery-${block.variant}`}>
    <div role={carousel ? "region" : undefined} aria-roledescription={carousel ? "carrusel" : undefined} aria-label={carousel ? "Fotos de la empresa" : undefined} tabIndex={carousel ? 0 : undefined}
      className="flex min-w-0 flex-col gap-6 rounded-xl focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
      onKeyDown={carousel ? event => {
        const index = { ArrowRight: active + 1, ArrowLeft: active - 1, Home: 0, End: items.length - 1 }[event.key];
        if (index !== undefined) { event.preventDefault(); move(index); }
      } : undefined}>
      <div className={cn("grid min-w-0 gap-6", !carousel && "sm:grid-cols-2", block.variant === "mosaic" && "sm:grid-cols-[1.5fr_1fr] sm:items-center")}>
        {items.map((item, index) => <figure key={index} hidden={carousel && active !== index} className={cn("min-w-0", block.variant === "mosaic" && "sm:even:pt-16")}>
          <SiteMedia image={item.image} alt={item.alt!} className={cn("aspect-4/3", block.variant === "mosaic" && index % 2 === 1 && "sm:aspect-3/4", carousel && "aspect-video")} />
          {item.caption && <figcaption className="mt-3 text-sm text-muted-foreground">{item.caption}</figcaption>}
        </figure>)}
      </div>
      {carousel && <div className="flex items-center justify-center gap-4">
        <Button variant="outline" size="icon" className="size-10" aria-label="Foto anterior" disabled={active === 0} onClick={() => move(active - 1)}><ChevronLeft aria-hidden="true" /></Button>
        <p role="status" aria-live="polite" aria-atomic="true" className="text-sm tabular-nums text-muted-foreground">{active + 1} de {items.length}</p>
        <Button variant="outline" size="icon" className="size-10" aria-label="Foto siguiente" disabled={active === items.length - 1} onClick={() => move(active + 1)}><ChevronRight aria-hidden="true" /></Button>
      </div>}
    </div>
  </div>;
}
