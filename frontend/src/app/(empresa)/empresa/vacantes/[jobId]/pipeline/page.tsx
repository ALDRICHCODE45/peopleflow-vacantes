import { notFound } from "next/navigation";

import { isValidJobId } from "@/features/jobs/jobId";
import { DraftPipelineState } from "@/features/employer-vacancies/draft-pipeline-state";

/**
 * Employer vacancy pipeline route content for
 * `/empresa/vacantes/[jobId]/pipeline`.
 *
 * Only real vacancies exist: a canonical UUID mounts the client board loader,
 * and any other id renders the framework not-found document. The shared
 * `(empresa)` layout owns the employer shell.
 */
type PipelineRouteProps = {
  params: Promise<{ jobId: string }>;
};

export default async function PipelinePage({ params }: PipelineRouteProps) {
  const { jobId } = await params;
  if (!isValidJobId(jobId)) notFound();
  return <DraftPipelineState draftId={jobId} />;
}
