import * as React from "react"

import { AppSidebar } from "./app-sidebar"
import { SidebarInset, SidebarProvider } from "./ui/sidebar"
import dashboardTheme from "./dashboard-01-theme.module.css"

/**
 * Shared employer frame for the `(empresa)` route group, mounted once by the
 * layout. The provider owns the desktop icon rail, the mobile Sheet/drawer, the
 * Ctrl/Meta+B shortcut and the server-derived `defaultOpen` cookie preference.
 */
export function EmployerShell({
  children,
  defaultOpen = true,
}: Readonly<{ children: React.ReactNode; defaultOpen?: boolean }>) {
  return (
    <SidebarProvider
      defaultOpen={defaultOpen}
      className={dashboardTheme.root}
      style={
        {
          "--sidebar-width": "calc(var(--spacing) * 72)",
          "--header-height": "calc(var(--spacing) * 12)",
        } as React.CSSProperties
      }
    >
      <AppSidebar variant="inset" collapsible="icon" />
      <SidebarInset>{children}</SidebarInset>
    </SidebarProvider>
  )
}
