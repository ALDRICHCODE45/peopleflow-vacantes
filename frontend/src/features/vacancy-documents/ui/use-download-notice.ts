"use client";

import { useEffect } from "react";
import { notifyActionResult } from "@/components/feedback/notify";
import { downloadFailureMessage } from "../failure";

const PARAM = "download_error";

/**
 * A download that failed on the server comes back as a redirect to this page with `?download_error=<code>` (the BFF file routes do that
 * for a browser navigation, so a failed download never saves a JSON body as a file). Says why with the failure copy, then removes the
 * parameter (keeping the others) so a reload or a shared address does not repeat it. An unknown code says nothing.
 */
export function useDownloadNotice(): void {
  useEffect(() => {
    const url = new URL(window.location.href);
    if (!url.searchParams.has(PARAM)) return;
    const code = url.searchParams.get(PARAM);
    const message = downloadFailureMessage(code);
    url.searchParams.delete(PARAM);
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
    if (message && code) notifyActionResult({ key: "vacancy-documents-download", type: "error", title: "No se pudo descargar el documento", description: message, reference: { code } });
  }, []);
}
