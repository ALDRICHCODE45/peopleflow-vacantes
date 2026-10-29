import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isValidJobId } from "@/features/jobs/jobId";
import { VacancyPsychometricsModule } from "@/features/psychometrics/profile";

export const metadata: Metadata = { title: "Psicometría · Configuración" };
export default async function Page({ params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  if (!isValidJobId(jobId)) notFound();
  return <VacancyPsychometricsModule draftId={jobId} />;
}
