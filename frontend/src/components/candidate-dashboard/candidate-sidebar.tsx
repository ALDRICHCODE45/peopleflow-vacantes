"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"

import { PeopleFlowLogo } from "@/components/brand/logo"
import { CandidateNavUser } from "./candidate-nav-user"
import {
  Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent,
  SidebarGroupLabel, SidebarHeader, SidebarMenu, SidebarMenuButton, SidebarMenuItem,
} from "@/components/company-dashboard/ui/sidebar"
import { IconBookmark, IconBriefcase, IconFileCv, IconLayoutDashboard, IconSearch, IconSettings, IconUserCircle } from "@tabler/icons-react"

type CandidateNavItem = { title: string; url: string; icon: React.ReactNode }

/** Candidate destinations in committed order; every destination is a real route. */
const CANDIDATE_NAV_GROUPS: Array<{ label: string; items: CandidateNavItem[] }> = [
  { label: "Mi búsqueda", items: [
    { title: "Dashboard", url: "/candidato/dashboard", icon: <IconLayoutDashboard /> },
    { title: "Postulaciones", url: "/candidato/postulaciones", icon: <IconBriefcase /> },
    { title: "Vacantes guardadas", url: "/candidato/guardadas", icon: <IconBookmark /> },
  ] },
  { label: "Mi perfil", items: [
    { title: "Perfil", url: "/candidato/perfil", icon: <IconUserCircle /> },
    { title: "CVs", url: "/candidato/cvs", icon: <IconFileCv /> },
    { title: "Configuración", url: "/candidato/configuracion", icon: <IconSettings /> },
  ] },
]

/** Active on the exact route and nested routes; unknown paths and sibling prefixes stay inactive. */
export function isActiveCandidateDestination(url: string, pathname: string | null): boolean {
  if (!url || !pathname) return false
  return pathname === url || pathname.startsWith(`${url}/`)
}

export function CandidateSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const pathname = usePathname()

  return (
    <Sidebar collapsible="offcanvas" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            {/* Native default geometry: the brand keeps the shared button's
                collapse behavior, its PeopleFlow link and its brand padding. */}
            <SidebarMenuButton className="data-[slot=sidebar-menu-button]:p-1.5!" render={<Link href="/candidato/dashboard" aria-label="PeopleFlow" />}>
              {/* The wordmark brands the header; candidate identity belongs to the account row. */}
              <PeopleFlowLogo className="h-5 w-auto" />
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        {CANDIDATE_NAV_GROUPS.map((group, index) => (
          <SidebarGroup key={group.label}>
            <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
            <SidebarGroupContent className={index === 0 ? "flex flex-col gap-2" : undefined}>
              {index === 0 && (
                <SidebarMenu>
                  <SidebarMenuItem>
                    {/* Native GET navigation keeps the primary action a button,
                        with no client handler or application side effects. */}
                    <form action="/vacantes" method="get">
                      <SidebarMenuButton
                        type="submit"
                        tooltip="Explorar vacantes"
                        className="min-w-8 bg-primary text-primary-foreground duration-200 ease-linear hover:bg-primary/90 hover:text-primary-foreground active:bg-primary/90 active:text-primary-foreground"
                      >
                        <IconSearch />
                        <span>Explorar vacantes</span>
                      </SidebarMenuButton>
                    </form>
                  </SidebarMenuItem>
                </SidebarMenu>
              )}
              <SidebarMenu>
                {/* Destinations use the native default geometry: no large rows
                    and no candidate-only icon-rail floor. */}
                {group.items.map((item) => (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton tooltip={item.title} isActive={isActiveCandidateDestination(item.url, pathname)} render={<Link href={item.url} />}>
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
        {/* The shared account row: a dropdown trigger, never a plain footer link. */}
        <CandidateNavUser />
      </SidebarFooter>
    </Sidebar>
  )
}
