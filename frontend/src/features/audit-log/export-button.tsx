"use client";
import { useEffect, useState } from "react";
import { CircleAlert, Download } from "lucide-react";
import { ActionStatus } from "@/components/feedback/action-status";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { downloadFilename, saveBlob } from "./download";
import { EXPORT_RANGE_MESSAGES, exportErrorMessage, exportRangeError, type ExportError } from "./model";
import { serializeFilters, toExportBody, type AuditFilters } from "./url-state";

const ROUTE = "/api/company/audit-events/export";
type Message = { tone: "error" | "success"; text: string };

async function errorOf(response: Response): Promise<ExportError> {
  try {
    const body: unknown = await response.json();
    const { code, row_count, limit } = (body ?? {}) as Record<string, unknown>;
    return {
      status: response.status,
      ...(typeof code === "string" ? { code } : {}),
      ...(typeof row_count === "number" && typeof limit === "number" ? { row_count, limit } : {}),
    };
  } catch { return { status: response.status }; }
}

/** Owner-only export: both dates are required (≤ 366 days) and nothing is downloaded unless the route answers 200. */
export function ExportAuditButton({ filters }: { filters: AuditFilters }) {
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<Message | null>(null);
  const key = serializeFilters(filters).toString();
  // A message about a previous range would mislead once the filters change.
  useEffect(() => setMessage(null), [key]);

  async function run() {
    if (pending) return;
    const invalid = exportRangeError(filters.from, filters.to);
    if (invalid) { setMessage({ tone: "error", text: EXPORT_RANGE_MESSAGES[invalid] }); return; }
    setPending(true); setMessage(null);
    try {
      const response = await fetch(ROUTE, { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify(toExportBody(filters)) });
      if (!response.ok) { setMessage({ tone: "error", text: exportErrorMessage(await errorOf(response)) }); return; }
      saveBlob(await response.blob(), downloadFilename(response.headers.get("content-disposition")));
      setMessage({ tone: "success", text: "Exportación descargada · queda registrada en la auditoría" });
    } catch { setMessage({ tone: "error", text: exportErrorMessage({}) }); }
    finally { setPending(false); }
  }

  return <div className="flex min-w-0 flex-col items-start gap-2 sm:items-end">
    <Button type="button" variant="outline" className="min-h-10" disabled={pending} aria-busy={pending} onClick={() => void run()}>
      {pending ? <Spinner data-icon="inline-start" aria-hidden="true" /> : <Download data-icon="inline-start" aria-hidden="true" />}
      {pending ? "Exportando…" : "Exportar CSV"}
    </Button>
    {message?.tone === "error" && <p role="alert" className="flex max-w-md items-center gap-2 text-sm text-status-danger sm:text-right"><CircleAlert aria-hidden="true" className="size-4 shrink-0" />{message.text}</p>}
    {message?.tone === "success" && <ActionStatus id="audit-export-status" tone="success" text={message.text} />}
  </div>;
}
