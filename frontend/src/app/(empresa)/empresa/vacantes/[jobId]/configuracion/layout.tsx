import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { isValidJobId } from "@/features/jobs/jobId";
import { VacancyConfigShell } from "@/features/employer-vacancies/vacancy-config/shell";

// Keep private configuration dynamic; the server shell reads no private data.
export const dynamic = "force-dynamic";

export default async function Layout({ params, children }: { params: Promise<{ jobId: string }>; children: ReactNode }) {
  const { jobId } = await params;
  if (!isValidJobId(jobId)) notFound();
  return <VacancyConfigShell draftId={jobId}>{children}</VacancyConfigShell>;
}
