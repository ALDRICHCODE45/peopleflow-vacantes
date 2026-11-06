import type { Metadata } from "next"

import { SiteHeader } from "@/components/company-dashboard/site-header"
import { AuditPage } from "@/features/audit-log/audit-page"

/**
 * Owner-only audit route: «Auditoría».
 *
 * The shared `(empresa)` layout owns the single EmployerShell, so this route
 * contributes its header and the mounted client page, which resolves the
 * membership before reading anything. It stays a server component with no
 * fetch or credential concern of its own.
 */
export const metadata: Metadata = {
  title: "Auditoría",
}

export default function Page() {
  return (
    <>
      <SiteHeader title="Auditoría" />
      <div className="@container/main flex flex-1 flex-col">
        <AuditPage />
      </div>
    </>
  )
}
