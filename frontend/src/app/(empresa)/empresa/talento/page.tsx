import type { Metadata } from "next"

import { SiteHeader } from "@/components/company-dashboard/site-header"
import { OrgCandidatesPage } from "@/features/org-candidates/org-candidates-page"

/**
 * Employer talent base route content: «Candidatos de mi organización».
 *
 * The shared `(empresa)` layout owns the single EmployerShell, the sidebar
 * provider and the theme module, so this route contributes only its header and
 * the mounted client page, which owns the page-content frame, the list and the
 * candidate sheet. It stays a server component with no fetch or credential
 * concern of its own.
 */
export const metadata: Metadata = {
  title: "Base de talento",
}

export default function Page() {
  return (
    <>
      <SiteHeader title="Base de talento" />
      <div className="@container/main flex flex-1 flex-col">
        <OrgCandidatesPage />
      </div>
    </>
  )
}
