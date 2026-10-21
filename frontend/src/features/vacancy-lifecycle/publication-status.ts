import type { Lifecycle } from "./model";

/** Compact status for headers and editor actions; process detail stays in the lifecycle summary. */
export function publicationStatus(publication: Lifecycle["publication"] | undefined, activeVariant: "accent" | "success" = "accent") {
  switch (publication) {
    case undefined: return { label: "Estado por confirmar", variant: "neutral", notice: "El estado de publicación está por confirmar. Recuerda guardar tus cambios." } as const;
    case null: return { label: "Borrador", variant: "info", notice: "Guarda tu progreso, incluso si aún faltan detalles. Solo será pública cuando la publiques." } as const;
    case "published": return { label: "Activa", variant: activeVariant, notice: "Esta vacante está activa. Los cambios se publican al guardar." } as const;
    case "paused": return { label: "Pausada", variant: "review", notice: "Esta vacante está pausada. Los cambios se guardan y se verán al reanudarla." } as const;
    case "closed": return { label: "Cerrada", variant: "neutral", notice: "Esta vacante está cerrada. Los cambios se guardan y se verán si la reabres." } as const;
  }
}
