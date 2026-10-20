import type { Metadata } from "next";
import { CandidateHeader } from "@/components/candidate-dashboard/candidate-header";
import { ProfileWorkspace } from "@/features/candidate/profile-workspace";

export const metadata: Metadata = { title: "Perfil" };

/** The layout owns authentication and the shell; the workspace loads real data. */
export default function Page() {
  return <><CandidateHeader title="Perfil" /><ProfileWorkspace /></>;
}
