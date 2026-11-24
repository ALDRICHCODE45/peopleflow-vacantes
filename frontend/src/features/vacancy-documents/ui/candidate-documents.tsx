"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { FolderOpen } from "lucide-react";
import { loadDocumentOverviewAction } from "../actions";
import { isId } from "../paths";
import { chooseCandidate, NO_FILTERS, type Filters } from "./rows";

/** The vacancy's Documentos tab narrowed to one candidate (`?candidato=<participation id>`). */
export const candidateDocumentsHref = (vacancyId: string, participationId: string) => `/empresa/vacantes/${vacancyId}/documentos?candidato=${participationId}`;

/** The tab's first filter: the candidate named by `?candidato=` (a UUID, never trimmed), otherwise none. */
export function initialDocumentFilters(search: string): Filters {
  const id = new URLSearchParams(search).get("candidato");
  return id && isId(id) ? chooseCandidate(NO_FILTERS, id) : NO_FILTERS;
}

/** «Documentos (n)» of one participation for the candidate sheet: the count comes from the same read the tab uses, the link opens that tab. */
export function CandidateDocuments({ vacancyId, participationId }: { vacancyId: string; participationId: string }) {
  const [count, setCount] = useState<number | null>(null);
  useEffect(() => {
    let current = true;
    setCount(null);
    Promise.resolve(loadDocumentOverviewAction(vacancyId, participationId)).then(result => {
      if (current && result?.ok) setCount(result.data.items.filter(item => item.participation_id === participationId).length);
    }, () => {});
    return () => { current = false; };
  }, [vacancyId, participationId]);
  const label = count === null ? "Documentos" : `Documentos (${count})`;
  return <Link href={candidateDocumentsHref(vacancyId, participationId)} className="inline-flex min-h-10 items-center gap-2 text-sm font-medium text-primary underline-offset-4 hover:underline"><FolderOpen aria-hidden="true" className="size-4" />{label}</Link>;
}
