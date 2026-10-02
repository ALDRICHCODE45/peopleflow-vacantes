import * as React from "react"

import { SidebarInset, SidebarProvider } from "@/components/company-dashboard/ui/sidebar"
import { CandidateSidebar } from "./candidate-sidebar"
import candidateTheme from "./candidate-theme.module.css"

/** Shared candidate frame, mounted once by the candidate route-group layout: the
    provider owns the icon rail, mobile drawer, shortcut and `defaultOpen`. */
export function CandidateShell({ children, defaultOpen = true }: Readonly<{ children: React.ReactNode; defaultOpen?: boolean }>) {
  return (
    <SidebarProvider
      defaultOpen={defaultOpen}
      className={`${candidateTheme.root} bg-primary/5`}
      style={{ "--sidebar-width": "calc(var(--spacing) * 72)", "--header-height": "calc(var(--spacing) * 12)" } as React.CSSProperties}
    >
      <CandidateSidebar variant="inset" collapsible="icon" />
      <SidebarInset className="md:mt-3 md:mr-3 md:mb-3 md:rounded-3xl md:ring-1 md:ring-primary/15 md:shadow-md">
        {children}
      </SidebarInset>
    </SidebarProvider>
  )
}
