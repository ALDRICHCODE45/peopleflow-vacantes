import type { Metadata } from "next"

import { SiteHeader } from "@/components/company-dashboard/site-header"
import { DashboardPageContent } from "@/components/dashboard-page-content"
import { AcceptOutcomePage } from "@/features/stakeholder-invitations/accept-page"
import { parseOutcome } from "@/features/stakeholder-invitations/model"

/** Token-free outcome of a stakeholder invitation (`?estado=…`), where the accept page lands after the server call. */
export const metadata: Metadata = {
  title: "Invitación",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
}

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { estado } = await searchParams
  return (
    <>
      <SiteHeader title="Invitación" />
      <DashboardPageContent className="flex-1 items-center justify-center">
        <div className="w-full max-w-xl">
          <AcceptOutcomePage outcome={parseOutcome(typeof estado === "string" ? estado : null)} />
        </div>
      </DashboardPageContent>
    </>
  )
}
