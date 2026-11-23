"use client";

import { useEffect } from "react";
import { notifyActionResult } from "@/components/feedback/notify";
import { downloadFailureMessage } from "../failure";

const PARAM = "download_error";

/**
 * A download that failed on the server comes back as a redirect to this page with `?download_error=<code>` (the BFF file routes do that
 * for a browser navigation, so a failed download never saves a JSON body as a file). Says why with the failure copy, then removes the
 * parameter once (keeping the others; the router is told, see the comment on the call) so a reload or a shared address does not repeat it. An unknown code says nothing.
 */
export function useDownloadNotice(): void {
  useEffect(() => {
    const url = new URL(window.location.href);
    if (!url.searchParams.has(PARAM)) return;
    const code = url.searchParams.get(PARAM);
    const message = downloadFailureMessage(code);
    url.searchParams.delete(PARAM);
    // `null` state, not `window.history.state`: Next's patched `replaceState` skips syncing its router with any state that carries its own
    // `__NA` marker, so passing the current one left the router believing the parameter was still there and a later router refresh put it
    // back (and the toast with it). A state of our own is synced: the address and the router agree the parameter is gone.
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
    if (message && code) notifyActionResult({ key: "vacancy-documents-download", type: "error", title: "No se pudo descargar el documento", description: message, reference: { code } });
  }, []);
}
