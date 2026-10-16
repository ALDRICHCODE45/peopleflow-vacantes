import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isValidJobId } from "@/features/jobs/jobId";
import { VacancyDeliveryModule } from "@/features/employer-vacancies/vacancy-config/delivery-module";

export const metadata: Metadata = { title: "Entrega · Configuración" };
export default async function Page({ params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  if (!isValidJobId(jobId)) notFound();
  return <VacancyDeliveryModule draftId={jobId} />;
}
