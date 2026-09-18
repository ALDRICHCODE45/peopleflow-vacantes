import type { Metadata } from "next"

import { AppSidebar } from "@/components/company-dashboard/app-sidebar"
import { ChartAreaInteractive } from "@/components/company-dashboard/chart-area-interactive"
import { DataTable } from "@/components/company-dashboard/data-table"
import { SectionCards } from "@/components/company-dashboard/section-cards"
import { SiteHeader } from "@/components/company-dashboard/site-header"
import {
  SidebarInset,
  SidebarProvider,
} from "@/components/company-dashboard/ui/sidebar"
import dashboardTheme from "@/components/company-dashboard/dashboard-01-theme.module.css"

import data from "./data.json"

export const metadata: Metadata = {
  title: "Panel de empresa",
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
        <SiteHeader />
        <div className="flex flex-1 flex-col">
          <div className="@container/main flex flex-1 flex-col gap-2">
            <div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6">
              <SectionCards />
              <div className="px-4 lg:px-6">
                <ChartAreaInteractive />
              </div>
              <DataTable data={data} />
            </div>
          </div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
