import type * as React from "react"
import Link from "next/link"

import { Separator } from "@/components/ui/separator"
import { ThemeToggle } from "@/components/theme/theme-toggle"
import { SidebarTrigger } from "./ui/sidebar"

/**
 * Linked ancestor rendered as a breadcrumb before the current page label.
 *
 * Future employer routes can point back to the section they belong to, for
 * example a vacancy pipeline linking to `/empresa/vacantes`.
 */
export type SiteHeaderParent = {
  label: string
  href: string
}

/**
 * Shared employer route header.
 *
 * The dashboard route keeps using it with no props, so `Dashboard` stays the
 * default title. Routes that live under a section can supply their own `title`,
 * an optional linked `parent` crumb, and optional `status` context while still
 * reusing the same shell controls (sidebar trigger, separator, theme toggle)
 * instead of re-implementing them.
 */
export function SiteHeader({
  title = "Dashboard",
  parent,
  status,
}: {
  title?: string
  parent?: SiteHeaderParent
  status?: React.ReactNode
}) {
  return (
    <header className="flex h-(--header-height) shrink-0 items-center gap-2 border-b transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-(--header-height)">
      <div className="flex w-full items-center gap-1 px-4 lg:gap-2 lg:px-6">
        <SidebarTrigger className="-ml-1" />
        <Separator
          orientation="vertical"
          className="mx-2 h-4 data-vertical:self-auto"
        />
        {parent ? (
          <nav
            aria-label="Ruta de navegación"
            className="flex min-w-0 items-center gap-2"
          >
            <Link
              href={parent.href}
              className="truncate rounded-sm text-sm text-muted-foreground outline-hidden transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              {parent.label}
            </Link>
            <span aria-hidden="true" className="text-muted-foreground">
              /
            </span>
          </nav>
        ) : null}
        <h1
          aria-current={parent ? "page" : undefined}
          className="truncate text-base font-medium"
        >
          {title}
        </h1>
        {status ? (
          <span className="flex shrink-0 items-center gap-1">{status}</span>
        ) : null}
        {/*
          Canonical PeopleFlow theme control, reused as-is: this header owns no
          theme state, storage key or bootstrap of its own. Its `size="icon"`
          (32px) is the narrowest standard control that fits the fixed
          `h-(--header-height)` header and its untouched padding, and it stays
          the group's only member, so it keeps the approved top-right position.
          No visibility gate on purpose: the control must stay reachable at the
          smallest breakpoint.
        */}
        <div className="ml-auto flex items-center gap-2">
          <ThemeToggle />
        </div>
      </div>
    </header>
  )
}
