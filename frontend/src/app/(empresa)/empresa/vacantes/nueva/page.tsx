import type { Metadata } from "next"

import { AppSidebar } from "@/components/company-dashboard/app-sidebar"
import {
  SidebarInset,
  SidebarProvider,
} from "@/components/company-dashboard/ui/sidebar"
import dashboardTheme from "@/components/company-dashboard/dashboard-01-theme.module.css"

import { CreateVacancyForm } from "@/features/jobs/create/CreateVacancyForm"
import { CreateVacancyHeader } from "@/features/jobs/create/CreateVacancyHeader"

/**
 * Employer create-vacancy route.
 *
 * A composition surface and nothing more: it mounts the committed employer
 * shell around this route's header and the verified form body. The shell frame,
 * its custom properties and the route-scoped theme module are mirrored from the
 * committed dashboard route, so both screens share one visual system.
 *
 * The content container widens to `max-w-7xl` because this screen carries the
 * section grid plus the 24rem dossier rail at `xl`; nothing else about the shell
 * changes.
 *
 * The route owns no data access, no client state and no credential concern. The
 * form body is the only interactive surface, and it stays fail-closed until real
 * recruiter authentication exists.
 */
export const metadata: Metadata = {
  title: "Nueva vacante",
}

export default function Page() {
  return (
    <SidebarProvider
      className={dashboardTheme.root}
      style={
        {
          "--sidebar-width": "calc(var(--spacing) * 72)",
          "--header-height": "calc(var(--spacing) * 12)",
        } as React.CSSProperties
      }
    >
      <AppSidebar variant="inset" />
      <SidebarInset>
        <CreateVacancyHeader />
        <div className="flex flex-1 flex-col">
          <div className="@container/main flex flex-1 flex-col gap-2">
            <div
              data-pf-create-vacancy-content=""
              className="mx-auto flex w-full max-w-7xl flex-col gap-5 px-4 py-4 md:gap-6 md:py-6 lg:px-6"
            >
              <CreateVacancyForm />
            </div>
          </div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
