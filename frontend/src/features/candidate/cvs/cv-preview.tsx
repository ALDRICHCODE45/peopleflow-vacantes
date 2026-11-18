import type { ReactNode } from "react";
import { FileText } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Cv } from "@/features/candidate-cvs/model";
import { formatSize, formatWord, isPdf } from "./format";

/** What the preview needs from a CV record. */
export type CvPreviewDocument = Pick<Cv, "name" | "content_type" | "size">;
export type CvPreviewProps = {
  cv: CvPreviewDocument;
  /** URL of a real first-page image (T12b: a thumbnail endpoint or an object URL). */
  src?: string;
  /** A real first-page renderer (for example a pdf.js canvas). Wins over `src`. */
  renderPage?: (cv: CvPreviewDocument) => ReactNode;
  /** `panel`: the large slot of the preview panel. `compact`: the 104 px slot of an expanded row, without the name. */
  size?: "panel" | "compact";
  className?: string;
};

/**
 * The first-page slot of a CV: an A4 page. With no `src` or `renderPage` it never draws fake document content; it
 * shows the format, the name and size, and says honestly that there is no preview yet (PDF) or in the browser (Word).
 */
export function CvPreview({ cv, src, renderPage, size = "panel", className }: CvPreviewProps) {
  const compact = size === "compact";
  // eslint-disable-next-line @next/next/no-img-element -- a first-page image from a private, same-origin or object URL; next/image would need a loader.
  const page = renderPage?.(cv) ?? (src ? <img src={src} alt={`Primera página de ${cv.name}`} className="size-full object-cover object-top" /> : null);
  const pdf = isPdf(cv);
  return <figure aria-label={`Vista previa de ${cv.name}`} data-pf-cv-preview data-state={page ? "page" : "placeholder"}
    className={cn("relative m-0 aspect-[210/297] w-full overflow-hidden rounded-md bg-card text-card-foreground shadow-md ring-1 ring-foreground/5", className)}>
    {page ?? <div className={cn("flex size-full flex-col items-center justify-center text-center", compact ? "gap-1.5 p-2.5" : "gap-3 p-[12%]")}>
      <span aria-hidden="true" className={cn("grid place-items-center rounded-xl ring-1 ring-inset", compact ? "size-8" : "size-14",
        pdf ? "bg-status-danger/9 text-status-danger ring-status-danger/22" : "bg-status-info/9 text-status-info ring-status-info/22")}>
        <FileText className={compact ? "size-4" : "size-7"} />
      </span>
      {!compact && <p className="line-clamp-3 font-semibold break-words">{cv.name}</p>}
      <p className={cn("font-medium text-muted-foreground tabular-nums", compact ? "text-[11px] leading-4" : "text-xs")}>{formatWord(cv)} · {formatSize(cv.size)}</p>
      <p className={cn("text-muted-foreground", compact ? "text-[10px] leading-3" : "max-w-56 text-xs leading-4")}>{pdf ? "Vista previa próximamente" : "Sin vista previa en el navegador. Descárgalo para verlo."}</p>
    </div>}
  </figure>;
}
