import type { Metadata } from "next"

import { SiteHeader } from "@/components/company-dashboard/site-header"
import { DashboardPageContent } from "@/components/dashboard-page-content"
import { CompanySiteEditor } from "@/features/company-site-editor/company-site-editor"

/**
 * Employer careers-site editor route content.
 *
 * The shared `(empresa)` layout owns the single EmployerShell, the sidebar
 * provider and the theme module, so this route contributes only its header and
 * the local editor. It stays a server component and owns no fetch, credential,
 * storage, transport or publication concern; the draft lives in the editor's
 * React state and reaches no public company profile.
 */
export const metadata: Metadata = {
  title: "Sitio de empleo",
}

export default function Page() {
  return (
    <>
      <SiteHeader title="Sitio de empleo" />
      <div className="@container/main flex flex-1 flex-col">
        {/* One outer padding owner: the shared page-content wrapper, so the
            editor and its preview add no second page inset. */}
        <DashboardPageContent
          data-pf-sitio-content=""
          width="screen-2xl"
          className="gap-5 md:gap-6"
        >
          <CompanySiteEditor />
        </DashboardPageContent>
      </div>
    </>
  )
}
