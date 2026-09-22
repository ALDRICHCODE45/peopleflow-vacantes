"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"

import { PeopleFlowLogo } from "@/components/brand/logo"
import {
  Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent,
  SidebarGroupLabel, SidebarHeader, SidebarMenu, SidebarMenuButton, SidebarMenuItem,
} from "@/components/company-dashboard/ui/sidebar"
import type { CandidateIdentity } from "@/features/candidate/model"
import { CANDIDATE_IDENTITY } from "@/features/candidate/prototype-candidate"
import { IconBriefcase, IconFileCv, IconLayoutDashboard, IconSettings, IconUserCircle } from "@tabler/icons-react"

type CandidateNavItem = { title: string; url: string; icon: React.ReactNode }

/** Candidate destinations in committed order; every destination is a real route. */
const CANDIDATE_NAV_GROUPS: Array<{ label: string; items: CandidateNavItem[] }> = [
  { label: "Mi búsqueda", items: [
    { title: "Dashboard", url: "/candidato/dashboard", icon: <IconLayoutDashboard /> },
    { title: "Postulaciones", url: "/candidato/postulaciones", icon: <IconBriefcase /> },
  ] },
  { label: "Mi perfil", items: [
    { title: "Perfil", url: "/candidato/perfil", icon: <IconUserCircle /> },
    { title: "CVs", url: "/candidato/cvs", icon: <IconFileCv /> },
    { title: "Cuenta", url: "/candidato/cuenta", icon: <IconSettings /> },
  ] },
]

/** Honest account label for the signed-in user type; no other user type exists. */
const CANDIDATE_USER_TYPE_LABELS: Readonly<Record<CandidateIdentity["userType"], string>> = { candidate: "Candidata" }

/** Local 40px icon-rail floor; `size="lg"` rows stay 48px while the sidebar is expanded. */
const ICON_RAIL_TARGET = "group-data-[collapsible=icon]:size-10!"

/** Active on the exact route and nested routes; unknown paths and sibling prefixes stay inactive. */
export function isActiveCandidateDestination(url: string, pathname: string | null): boolean {
  if (!url || !pathname) return false
  return pathname === url || pathname.startsWith(`${url}/`)
}

function candidateInitials(fullName: string): string {
  return fullName.trim().split(/\s+/).slice(0, 2).map((part) => part.charAt(0).toUpperCase()).join("")
}

export function CandidateSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const pathname = usePathname()

  return (
    <Sidebar collapsible="offcanvas" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton className={`${ICON_RAIL_TARGET} h-10 data-[slot=sidebar-menu-button]:p-1.5!`} render={<Link href="/candidato/dashboard" aria-label="PeopleFlow" />}>
              {/* The wordmark brands the header; candidate identity belongs to the account row. */}
              <PeopleFlowLogo className="h-5 w-auto" />
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        {CANDIDATE_NAV_GROUPS.map((group) => (
          <SidebarGroup key={group.label}>
            <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {/* `size="lg"` is 48px expanded; `ICON_RAIL_TARGET` floors the icon rail at 40px. */}
                {group.items.map((item) => (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton className={ICON_RAIL_TARGET} size="lg" tooltip={item.title} isActive={isActiveCandidateDestination(item.url, pathname)} render={<Link href={item.url} />}>
                      {item.icon}
                      <span>{item.title}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            {/* A plain account link: no dropdown, session, logout or credential action. */}
            <SidebarMenuButton className={ICON_RAIL_TARGET} size="lg" tooltip="Cuenta de candidata" render={<Link href="/candidato/cuenta" />}>
              <span aria-hidden="true" className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-sidebar-primary text-xs font-medium text-sidebar-primary-foreground">
                {candidateInitials(CANDIDATE_IDENTITY.fullName)}
              </span>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-medium">{CANDIDATE_IDENTITY.fullName}</span>
                <span className="truncate text-xs text-foreground/70">
                  {CANDIDATE_USER_TYPE_LABELS[CANDIDATE_IDENTITY.userType]} · {CANDIDATE_IDENTITY.email}
                </span>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  )
}
