import type { Metadata } from "next"

import { SiteHeader } from "@/components/company-dashboard/site-header"
import { DashboardPageContent } from "@/components/dashboard-page-content"
import { AcceptInvitationPage } from "@/features/stakeholder-invitations/accept-page"

/**
 * Stakeholder invitation link (stakeholder-metrics-v1 §1.3). The middleware sends this page with
 * `Referrer-Policy: no-referrer` and `no-store`; the client page accepts through a Server Action and replaces the URL
 * with a token-free outcome. The token is never logged here.
 */
export const metadata: Metadata = {
  title: "Invitación",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
}

export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  return (
    <>
      <SiteHeader title="Invitación" />
      <DashboardPageContent className="flex-1 items-center justify-center">
        <div className="w-full max-w-xl">
          <AcceptInvitationPage token={token} />
        </div>
      </DashboardPageContent>
    </>
  )
}
