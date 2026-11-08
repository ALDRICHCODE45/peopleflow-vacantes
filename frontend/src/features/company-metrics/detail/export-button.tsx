"use client";
import { useEffect, useState, type MouseEvent } from "react";
import { CircleAlert, Download } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { saveBlob } from "@/features/audit-log/download";
import { cn } from "@/lib/utils";
import type { DetailState } from "./query";

const FALLBACK_FILE = "metricas.csv";
const FAILED = "No pudimos exportar los registros. Inténtalo de nuevo.";
const filename = (disposition: string | null) => {
  const name = (disposition && /filename="?([^";]*)"?/i.exec(disposition)?.[1]) || "";
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,100}$/.test(name) ? name : FALLBACK_FILE;
};
/** A plain click downloads here; a modified click (new tab) keeps the browser's default. */
const plainClick = (event: MouseEvent) => event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;

async function errorOf(response: Response): Promise<string> {
  try {
    const { message } = ((await response.json()) ?? {}) as Record<string, unknown>;
    if (typeof message === "string") return message;
  } catch { /* A body that is not JSON says nothing readable. */ }
  return response.status === 401 ? "Tu sesión expiró. Inicia sesión de nuevo para exportar." : FAILED;
}

/**
 * «Exportar CSV» (v2 §8): a link to the same-origin route with the list's validated query. Nothing is downloaded unless
 * the route answers 200, so a refused export (more than 50,000 rows, an expired session) explains itself next to it.
 */
export function ExportDetailButton({ state }: { state: DetailState }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const href = `/api/company/metrics/${state.kind}/export?${new URLSearchParams(state.params)}`;
  // A message about previous filters would mislead once they change.
  useEffect(() => setError(null), [href]);

  async function run(event: MouseEvent<HTMLAnchorElement>) {
    if (!plainClick(event)) return;
    event.preventDefault();
    if (pending) return;
    setPending(true); setError(null);
    try {
      const response = await fetch(href, { credentials: "same-origin" });
      if (!response.ok) { setError(await errorOf(response)); return; }
      saveBlob(await response.blob(), filename(response.headers.get("content-disposition")));
    } catch { setError(FAILED); }
    finally { setPending(false); }
  }

  return <div className="flex min-w-0 flex-col items-start gap-2 sm:items-end">
    <a href={href} onClick={event => void run(event)} aria-busy={pending || undefined} className={cn(buttonVariants({ variant: "outline" }), "min-h-10 gap-2 px-4")}>
      {pending ? <Spinner aria-hidden="true" /> : <Download aria-hidden="true" />}Exportar CSV
    </a>
    {error && <p role="alert" className="flex max-w-md items-center gap-2 text-sm text-status-danger sm:text-right"><CircleAlert aria-hidden="true" className="size-4 shrink-0" />{error}</p>}
  </div>;
}
