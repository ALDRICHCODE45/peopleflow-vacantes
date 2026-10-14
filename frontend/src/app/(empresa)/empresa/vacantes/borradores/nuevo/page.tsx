import type { Metadata } from "next"

import { SiteHeader } from "@/components/company-dashboard/site-header"
import { DashboardPageContent } from "@/components/dashboard-page-content"
import { LocalDraftForm } from "@/features/jobs/drafts/ui/local-draft-form"

/**
 * Local private-draft route content.
 *
 * The shared `(empresa)` layout owns the single EmployerShell, so this route
 * contributes only its header and the mounted local editor. It stays a server
 * component and owns no fetch, credential, storage or mutation concern; the
 * editor arrives as a client component over the accepted T3f draft model and
 * writes nowhere.
 */
export const metadata: Metadata = {
  title: "Nuevo borrador",
}

export default function Page() {
  return (
    <>
      <SiteHeader
        title="Nuevo borrador"
        parent={{ label: "Vacantes", href: "/empresa/vacantes" }}
      />
      <div className="@container/main flex flex-1 flex-col">
        <DashboardPageContent
          data-pf-draft-vacante-content=""
          width="7xl"
          className="gap-5 md:gap-6"
        >
          <LocalDraftForm />
        </DashboardPageContent>
      </div>
    </>
  )
}
