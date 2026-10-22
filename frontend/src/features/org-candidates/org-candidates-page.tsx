"use client";

import * as React from "react";

import { OrgCandidateDetailSheet } from "./detail/detail-sheet";
import type { OrgCandidateDetail } from "./detail/detail-model";
import { OrgCandidatesWorkspace } from "./list/list-workspace";

type CandidateIdentity = { kind: "manual" | "organic"; id: string };

/** «Candidatos de mi organización»: the list opens one candidate at a time in the detail sheet. */
export function OrgCandidatesPage() {
  const [selected, setSelected] = React.useState<CandidateIdentity | null>(null);
  const [updatedCandidate, setUpdatedCandidate] = React.useState<OrgCandidateDetail | null>(null);
  return <>
    <OrgCandidatesWorkspace onOpenCandidate={setSelected} updatedCandidate={updatedCandidate} />
    <OrgCandidateDetailSheet candidate={selected} onOpenChange={open => { if (!open) setSelected(null); }} onCandidateUpdated={setUpdatedCandidate} />
  </>;
}
