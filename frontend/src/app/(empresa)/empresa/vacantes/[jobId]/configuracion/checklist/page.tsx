import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isValidJobId } from "@/features/jobs/jobId";
import { VacancyChecklistModule } from "@/features/employer-vacancies/vacancy-config/checklist-module";

export const metadata: Metadata = { title: "Checklist · Configuración" };
export default async function Page({ params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  if (!isValidJobId(jobId)) notFound();
  return <VacancyChecklistModule draftId={jobId} />;
}
