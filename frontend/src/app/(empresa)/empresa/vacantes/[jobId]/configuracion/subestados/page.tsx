import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isValidJobId } from "@/features/jobs/jobId";
import { VacancySubstatesModule } from "@/features/employer-vacancies/vacancy-config/substates-module";

export const metadata: Metadata = { title: "Subestados · Configuración" };

export default async function Page({ params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  if (!isValidJobId(jobId)) notFound();
  return <VacancySubstatesModule draftId={jobId} />;
}
