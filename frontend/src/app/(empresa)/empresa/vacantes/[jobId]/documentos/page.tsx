import { notFound } from "next/navigation";

import { isValidJobId } from "@/features/jobs/jobId";
import { VacancyDocumentsScreen } from "@/features/employer-vacancies/vacancy-documents-screen";

/**
 * Employer vacancy Documentos tab: `/empresa/vacantes/[jobId]/documentos`.
 *
 * Only real vacancies exist: a canonical UUID mounts the vacancy frame with the Documentos tab, and any other id renders the
 * framework not-found document. The shared `(empresa)` layout owns the employer shell.
 */
export default async function DocumentsPage({ params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  if (!isValidJobId(jobId)) notFound();
  return <VacancyDocumentsScreen vacancyId={jobId} />;
}
