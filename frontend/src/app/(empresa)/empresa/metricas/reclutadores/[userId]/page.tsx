import type { Metadata } from "next"
import { notFound } from "next/navigation"

import { SiteHeader } from "@/components/company-dashboard/site-header"
import { UUID_PATTERN } from "@/features/company-metrics/model"
import { RecruiterDetailPage } from "@/features/company-metrics/recruiter-detail"

/**
 * One recruiter's card inside «Métricas». A malformed id never reaches the
 * API; the client page resolves the membership role before reading anything.
 */
export const metadata: Metadata = {
  title: "Ficha del reclutador · Métricas",
}

export default async function Page({ params }: { params: Promise<{ userId: string }> }) {
  const { userId } = await params
  if (!UUID_PATTERN.test(userId)) notFound()
  return (
    <>
      <SiteHeader title="Métricas" />
      <div className="@container/main flex flex-1 flex-col">
        <RecruiterDetailPage userId={userId} />
      </div>
    </>
  )
}
