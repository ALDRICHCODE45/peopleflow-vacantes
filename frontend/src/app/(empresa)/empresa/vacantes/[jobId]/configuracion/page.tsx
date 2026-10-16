import { notFound, redirect } from "next/navigation";
import { isValidJobId } from "@/features/jobs/jobId";

export default async function Page({ params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  if (!isValidJobId(jobId)) notFound();
  redirect(`/empresa/vacantes/${jobId}/configuracion/columnas`);
}
