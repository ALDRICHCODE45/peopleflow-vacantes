"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { GitBranch } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SiteHeader } from "@/components/company-dashboard/site-header";

/** What the editor page knows about its record: unknown while loading, then a draft or a vacancy already published. */
export type DraftPageState = "unknown" | "draft" | "vacancy";
const Report = createContext<((state: DraftPageState) => void) | null>(null);
const Current = createContext<DraftPageState>("unknown");

/** Lets the page chrome (top bar title, «Configurar columnas») follow the record the editor loaded. */
export function DraftPageChromeProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<DraftPageState>("unknown");
  return <Report value={setState}><Current value={state}>{children}</Current></Report>;
}

/** The editor reports once what it is editing; outside a provider (tests, other hosts) it is a no-op. */
export function useReportDraftPageState(state: DraftPageState) {
  const report = useContext(Report);
  useEffect(() => { report?.(state); }, [report, state]);
}

/** «Editar borrador» only for a draft; a published vacancy (or one still loading) reads «Editar vacante». */
export function DraftPageHeader() {
  const state = useContext(Current);
  return <SiteHeader title={state === "draft" ? "Editar borrador" : "Editar vacante"} parent={{ label: "Vacantes", href: "/empresa/vacantes" }} />;
}

/** The pipeline columns are set up while it is a draft; a published vacancy configures them from its own Configuración tab. */
export function DraftColumnsLink({ draftId }: { draftId: string }) {
  if (useContext(Current) !== "draft") return null;
  return <Button nativeButton={false} role="link" variant="outline" className="min-h-10 self-start" render={<Link href={`/empresa/vacantes/${draftId}/configuracion/columnas`} />}>
    <GitBranch aria-hidden="true" data-icon="inline-start" />Configurar columnas
  </Button>;
}
