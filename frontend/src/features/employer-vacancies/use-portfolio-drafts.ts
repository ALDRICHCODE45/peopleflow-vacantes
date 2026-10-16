"use client";

import { useCallback, useEffect, useState } from "react";
import { listDraftsAction, type DraftListActionFailure } from "@/features/jobs/drafts/list/actions";
import type { DraftListRow } from "@/features/jobs/drafts/list/client";
import { dismissActionResult, notifyActionResult } from "@/components/feedback/notify";

export const DRAFT_LIST_MESSAGES: Record<DraftListActionFailure["reason"], string> = {
  unauthenticated: "Tu sesión expiró. Inicia sesión para ver tus borradores.",
  forbidden: "No tienes permiso para ver estos borradores. Usa la cuenta responsable de las vacantes.",
  company_inactive: "Tu empresa está inactiva. Revisa su configuración para ver los borradores.",
  company_not_active: "Falta activar tu empresa para ver los borradores. Revisa su configuración.",
  invalid_request: "No pudimos completar la consulta. Intenta cargar los borradores de nuevo.",
  server_error: "El servidor tuvo un problema. Es seguro reintentar; no se modificó ningún borrador.",
  no_response: "No hubo respuesta del servidor. Revisa tu conexión y reintenta; no se modificó ningún borrador.",
  unrecognized_response: "No pudimos leer los borradores recibidos. Es seguro reintentar; no se modificó su contenido.",
};

/** Sequential, bounded read; never retries implicitly or passes list versions to the editor. */
export function usePortfolioDrafts() {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{ items: DraftListRow[]; pending: boolean; failure: DraftListActionFailure | null; capped: boolean }>({ items: [], pending: true, failure: null, capped: false });
  const retry = useCallback(() => {
    dismissActionResult("portfolio-drafts");
    setState(previous => ({ ...previous, pending: true }));
    setAttempt(value => value + 1);
  }, []);
  useEffect(() => {
    let current = true;
    async function load() {
      const rows = new Map<string, DraftListRow>();
      let cursor: string | undefined;
      try {
        for (let page = 0; page < 10; page++) {
          const result = await listDraftsAction({ limit: 50, ...(cursor !== undefined ? { cursor } : {}) });
          if (!current) return;
          if (!result.ok) {
            // Preserve the last complete snapshot rather than imply partial counts are complete.
            setState(previous => ({ ...previous, pending: false, failure: result }));
            if (attempt > 0) notifyActionResult({ key: "portfolio-drafts", type: "error", title: "No se cargaron los borradores", description: DRAFT_LIST_MESSAGES[result.reason], reference: { ...result.reference, at: new Date().toISOString() } });
            return;
          }
          for (const row of result.items) if (!rows.has(row.id)) rows.set(row.id, row);
          if (result.nextCursor === null || page === 9) {
            const items = [...rows.values()].sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at) || b.id.localeCompare(a.id));
            setState({ items, pending: false, failure: null, capped: result.nextCursor !== null });
            if (attempt > 0) notifyActionResult({ key: "portfolio-drafts", type: "success", title: "Borradores cargados", description: "La lista de vacantes está actualizada." });
            return;
          }
          cursor = result.nextCursor;
        }
      } catch {
        if (!current) return;
        const failure = { ok: false, reason: "no_response", reference: {} } as const;
        setState(previous => ({ ...previous, pending: false, failure }));
        if (attempt > 0) notifyActionResult({ key: "portfolio-drafts", type: "error", title: "No se cargaron los borradores", description: DRAFT_LIST_MESSAGES.no_response, reference: { at: new Date().toISOString() } });
      }
    }
    void load();
    return () => { current = false; };
  }, [attempt]);
  const published = (id: string, publishedAt: string) => setState(previous => ({ ...previous, items: previous.items.map(item => item.id === id ? { ...item, status: "published", published_at: publishedAt } : item) }));
  return { ...state, retry, published, retried: attempt > 0 };
}
