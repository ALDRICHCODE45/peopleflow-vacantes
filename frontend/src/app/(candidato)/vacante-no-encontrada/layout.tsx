import type { ReactNode } from "react";
import { CandidateHeader } from "@/components/candidate-dashboard/candidate-header";

/** Keep the public vacancy navigation without inheriting its loading boundary. */
export default function VacanteNoEncontradaLayout({ children }: { children: ReactNode }) {
  return <>
    <CandidateHeader title="Vacante no encontrada" parent={{ label: "Vacantes", href: "/vacantes" }} heading={false} />
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 lg:px-6">{children}</div>
  </>;
}
