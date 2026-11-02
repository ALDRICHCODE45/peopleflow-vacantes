import type { Metadata } from "next"

import { CandidateHeader } from "@/components/candidate-dashboard/candidate-header"
import { ApplicationsWorkspace } from "@/features/candidate/applications-workspace"

export const metadata: Metadata = {
  title: "Postulaciones",
}

/** The candidate layout guards identity; the workspace loads the private list. */
export default async function Page({ searchParams }: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>
} = {}) {
  const params = await searchParams
  const initialApplicationId = typeof params?.postulacion === "string" ? params.postulacion : undefined
  return (
    <>
      <CandidateHeader title="Postulaciones" />
      <ApplicationsWorkspace initialApplicationId={initialApplicationId} />
    </>
  )
}
