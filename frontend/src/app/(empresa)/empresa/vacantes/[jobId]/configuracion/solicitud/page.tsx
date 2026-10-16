import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isValidJobId } from "@/features/jobs/jobId";
import { VacancyManagementModule } from "@/features/employer-vacancies/vacancy-config/management-module";

export const metadata: Metadata = { title: "Solicitud · Configuración" };
export default async function Page({ params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  if (!isValidJobId(jobId)) notFound();
  return <VacancyManagementModule draftId={jobId} />;
}
