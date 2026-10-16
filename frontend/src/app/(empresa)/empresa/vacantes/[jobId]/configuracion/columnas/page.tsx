import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isValidJobId } from "@/features/jobs/jobId";
import { VacancyColumnsModule } from "@/features/employer-vacancies/vacancy-config/columns-module";

export const metadata: Metadata = { title: "Columnas del pipeline · Configuración" };

export default async function Page({ params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  if (!isValidJobId(jobId)) notFound();
  return <VacancyColumnsModule draftId={jobId} />;
}
