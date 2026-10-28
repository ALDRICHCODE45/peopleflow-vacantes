import { notFound } from "next/navigation";
import { isValidJobId } from "@/features/jobs/jobId";
import { ComparisonPage } from "@/features/vacancy-checklist/compare/ui";

export const metadata = { title: "Comparar candidatos | PeopleFlow" };
type Props = { params: Promise<{ jobId: string }>; searchParams: Promise<{ ids?: string | string[] }> };
/** Like the pipeline, actions run in the mounted client loader so refreshed auth cookies persist. */
export default async function Page({ params, searchParams }: Props) {
  const { jobId } = await params;
  if (!isValidJobId(jobId)) notFound();
  const { ids } = await searchParams;
  return <ComparisonPage jobId={jobId} ids={typeof ids === "string" ? ids : ""} />;
}
