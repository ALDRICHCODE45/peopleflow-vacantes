import Link from "next/link"

import { ThemeToggle } from "@/components/theme/theme-toggle"
import { Separator } from "@/components/ui/separator"
import { SidebarTrigger } from "@/components/company-dashboard/ui/sidebar"

/** Linked ancestor rendered as a breadcrumb before the current candidate label. */
export type CandidateHeaderParent = { label: string; href: string }

/** Shared candidate route header: the shell controls every candidate route needs
    plus an optional linked parent crumb; ThemeToggle owns no persisted state. */
export function CandidateHeader({ title = "Dashboard", parent }: { title?: string; parent?: CandidateHeaderParent }) {
  return (
    <header className="flex h-(--header-height) shrink-0 items-center gap-2 border-b transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-(--header-height)">
      <div className="flex w-full items-center gap-1 px-4 lg:gap-2 lg:px-6">
        <SidebarTrigger className="-ml-1" />
        <Separator orientation="vertical" className="mx-2 h-4 data-vertical:self-auto" />
        {parent ? (
          <nav aria-label="Ruta de navegación" className="flex min-w-0 items-center gap-2">
            <Link href={parent.href} className="truncate rounded-sm text-sm text-muted-foreground outline-hidden transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50">
              {parent.label}
            </Link>
            <span aria-hidden="true" className="text-muted-foreground">/</span>
          </nav>
        ) : null}
        <h1 aria-current={parent ? "page" : undefined} className="truncate text-base font-medium">{title}</h1>
        <div className="ml-auto flex items-center gap-2">
          <ThemeToggle />
        </div>
      </div>
    </header>
  )
}
