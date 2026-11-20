"use client";

import { useRouter } from "next/navigation";
import { StartReplacementDialog } from "@/features/vacancy-replacement/start-replacement-dialog";
import { vacancyPipelineHref } from "./model";
import type { ReplacementSource } from "./replacement-source";

/**
 * The start-replacement dialog for one request, with the navigation that follows it: the new draft's pipeline,
 * then a refresh so the lists behind show the source finished. Mounted only while a request exists, so a screen
 * pays for the router only when someone asks for a replacement.
 */
export function StartReplacementHost({ draftId, title, creditId, source, onClose }: { draftId: string; title?: string; creditId?: string; source: ReplacementSource; onClose: () => void }) {
  const router = useRouter();
  return <StartReplacementDialog draftId={draftId} title={title} open preselectedCreditId={creditId} stages={source.stages} unavailableHires={source.unavailableHires}
    onOpenChange={open => { if (!open) onClose(); }}
    onStarted={newDraftId => { router.push(vacancyPipelineHref(newDraftId)); router.refresh(); }} />;
}
