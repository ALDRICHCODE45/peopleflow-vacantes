"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { CircleAlert, CircleCheck, Hourglass, Link2, MailCheck, MailX } from "lucide-react";
import { StateCard } from "@/components/feedback/state-card";
import { preferencesHref } from "../copy";
import type { NotificationScope } from "../model";
import { UNSUBSCRIBE_COPY as COPY, unsubscribePreferencesLinks } from "../unsubscribe-copy";

/** What the landing's GET found; built on the server, never carries the token. */
export type UnsubscribeView =
  | { kind: "ready"; heading: string; scope: NotificationScope; enabled: boolean }
  | { kind: "invalid" } | { kind: "rate_limited" } | { kind: "error" };
/** What the confirm (server action → backend POST) answered. */
export type ConfirmOutcome = "done" | "invalid" | "rate_limited" | "error";

function InvalidLink() {
  const [company, candidate] = unsubscribePreferencesLinks();
  return <StateCard icon={Link2} tone="empty" title={COPY.invalid} description={COPY.invalidNote}
    primaryAction={company} secondaryAction={candidate} />;
}

/**
 * `/notificaciones/baja?token=`: the GET only shows what the link turns off; nothing changes until «Dejar de recibir»
 * runs the server action (contract v2 Q4), so a link scanner's visit never unsubscribes anyone.
 */
export function UnsubscribeLanding({ view, confirmAction }: { view: UnsubscribeView; confirmAction?: () => Promise<ConfirmOutcome> }) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [outcome, setOutcome] = React.useState<ConfirmOutcome | null>(null);
  if (view.kind === "invalid" || outcome === "invalid") return <InvalidLink />;
  if (view.kind === "rate_limited") return <StateCard icon={Hourglass} tone="info" title={COPY.rateLimited} description={COPY.rateLimitedNote} />;
  if (view.kind === "error") return <StateCard icon={CircleAlert} tone="error" title={COPY.loadError} description={COPY.retryNote}
    primaryAction={{ label: COPY.retry, onClick: () => router.refresh() }} />;
  const adjust = { label: COPY.adjust, href: preferencesHref(view.scope) };
  if (outcome === "done") return <StateCard icon={CircleCheck} tone="info" title={COPY.done} description={COPY.doneNote} primaryAction={adjust} role="status" />;
  if (!view.enabled) return <StateCard icon={MailCheck} tone="info" title={COPY.alreadyOff} description={COPY.alreadyOffNote} primaryAction={adjust} />;
  const confirm = () => startTransition(async () => {
    setOutcome(null);
    const next = await (confirmAction?.() ?? Promise.resolve<ConfirmOutcome>("error")).catch((): ConfirmOutcome => "error");
    setOutcome(next);
  });
  return <StateCard icon={MailX} tone="info" title={view.heading}
    description={<><span className="block">{COPY.currentlyOn}</span><span className="block">{COPY.scopeNote}</span></>}
    primaryAction={{ label: pending ? COPY.confirming : COPY.confirm, onClick: confirm, disabled: pending }}>
    {(outcome === "rate_limited" || outcome === "error") && <p role="alert" className="text-sm text-destructive">
      {outcome === "rate_limited" ? COPY.rateLimited : COPY.retryNote}
    </p>}
  </StateCard>;
}
