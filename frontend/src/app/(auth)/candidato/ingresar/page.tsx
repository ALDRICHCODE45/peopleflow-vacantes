import type { Metadata } from "next";
import { Suspense } from "react";
import { IdentityCheck } from "@/features/identity/identity-states";
import { IdentitySessionProvider } from "@/features/identity/identity-session";
import { CandidateEntry } from "@/features/identity/candidate-entry";

export const metadata: Metadata = { title: "Tu cuenta de candidato", robots: { index: false, follow: false } };

/** Outside the candidate shell: no account is created by rendering this route. */
export default function CandidateEntryPage() {
  return <main className="flex min-h-dvh items-center justify-center bg-background p-4 sm:p-6"><div className="w-full max-w-2xl"><IdentitySessionProvider><Suspense fallback={<IdentityCheck />}><CandidateEntry /></Suspense></IdentitySessionProvider></div></main>;
}
