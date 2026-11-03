import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { isValidJobId } from "@/features/jobs/jobId";
import { VacancyConfigShell } from "@/features/employer-vacancies/vacancy-config/shell";
import { prototypeEnabled } from "@/features/vacancy-team/model";

// Keep private configuration dynamic; the server shell reads no private data.
export const dynamic = "force-dynamic";

export default async function Layout({ params, children }: { params: Promise<{ jobId: string }>; children: ReactNode }) {
  const { jobId } = await params;
  if (!isValidJobId(jobId)) notFound();
  const enabled = prototypeEnabled(process.env.NODE_ENV, process.env.NEXT_PUBLIC_VACANCY_TEAM_PROTOTYPE);
  return <VacancyConfigShell draftId={jobId} {...(enabled ? { teamPrototypeEnabled: true } : {})}>{children}</VacancyConfigShell>;
}
