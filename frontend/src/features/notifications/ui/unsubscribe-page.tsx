import "server-only";
import { headers } from "next/headers";
import { getUnsubscribe, isUnsubscribeTokenShape, postUnsubscribe } from "../client";
import { toNotificationFailure } from "../failure";
import type { UnsubscribeResult } from "../model";
import { unsubscribeHeading, unsubscribeScope } from "../unsubscribe-copy";
import { UnsubscribeLanding, type ConfirmOutcome, type UnsubscribeView } from "./unsubscribe-landing";

/** The same RFC 8058 body a mail provider sends, so the backend sees one kind of POST. */
const ONE_CLICK_BODY = new TextEncoder().encode("List-Unsubscribe=One-Click");

async function settle(run: () => Promise<Awaited<ReturnType<typeof getUnsubscribe>>>): Promise<UnsubscribeResult> {
  try {
    const result = await run();
    return result.ok ? result : toNotificationFailure(result);
  } catch { return { ok: false, reason: "no_response", reference: {} }; }
}

function viewOf(result: UnsubscribeResult): UnsubscribeView {
  if (result.ok) {
    const company = result.data.company?.name ?? null;
    return { kind: "ready", heading: unsubscribeHeading(result.data.type, company), scope: unsubscribeScope(company), enabled: result.data.enabled };
  }
  if (result.reason === "unsubscribe_link_invalid") return { kind: "invalid" };
  if (result.reason === "rate_limited") return { kind: "rate_limited" };
  return { kind: "error" };
}

/**
 * Server side of `/notificaciones/baja?token=` (contract v2 E7, Q4, L23). Reads the link with the backend GET (which
 * never mutates) and confirms through an inline Server Action that calls the backend POST. Both carry the proxy headers
 * of the incoming request and no session. The token stays on the server: Next encrypts the closure, and only the
 * view and the outcome reach the browser (do not pass the token as a prop or `.bind` it).
 */
export async function UnsubscribePage({ token }: { token: string | null }) {
  const valid = isUnsubscribeTokenShape(token);
  const view = valid ? viewOf(await settle(async () => getUnsubscribe({ token, incoming: await headers() }))) : { kind: "invalid" as const };
  async function confirmAction(): Promise<ConfirmOutcome> {
    "use server";
    const result = await settle(async () => postUnsubscribe({ token, incoming: await headers(), body: ONE_CLICK_BODY }));
    if (result.ok) return "done";
    if (result.reason === "unsubscribe_link_invalid") return "invalid";
    return result.reason === "rate_limited" ? "rate_limited" : "error";
  }
  return (
    <main className="flex min-h-svh items-center justify-center bg-muted/30 p-4">
      <div className="w-full max-w-xl">
        <UnsubscribeLanding view={view} confirmAction={view.kind === "ready" && view.enabled ? confirmAction : undefined} />
      </div>
    </main>
  );
}
