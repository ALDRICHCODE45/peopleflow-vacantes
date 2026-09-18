import type { Metadata } from "next"

import { ChartAreaInteractive } from "@/components/company-dashboard/chart-area-interactive"
import { DataTable } from "@/components/company-dashboard/data-table"
import { SectionCards } from "@/components/company-dashboard/section-cards"
import { SiteHeader } from "@/components/company-dashboard/site-header"

import data from "./data.json"

export const metadata: Metadata = {
  title: "Panel de empresa",
}

/**
 * Employer dashboard route content: the shared `(empresa)` layout mounts the
 * employer shell, so this route owns only its header and body.
 */
export default function Page() {
  return (
    <>
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
    </>
  )
}
