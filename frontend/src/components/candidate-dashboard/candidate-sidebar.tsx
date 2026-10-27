"use client"

import Link, { useLinkStatus } from "next/link"
import { usePathname } from "next/navigation"

import { PeopleFlowSidebarLogo } from "@/components/brand/logo"
import { useCandidateViewer } from "./candidate-viewer"
import { CandidateFooterSkeleton, CandidateVisitorFooter } from "./candidate-visitor"
import { Card, CardHeader, CardTitle, CardFooter } from "@/components/ui/card"
import { buttonVariants } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { cn } from "@/lib/utils"
import { CandidateNavUser } from "./candidate-nav-user"
import {
  Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent,
  SidebarGroupLabel, SidebarHeader, SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar,
} from "@/components/company-dashboard/ui/sidebar"
import { IconBookmark, IconBriefcase, IconFileCv, IconLayoutDashboard, IconSearch, IconSettings, IconUserCircle } from "@tabler/icons-react"

type CandidateNavItem = { title: string; url: string; icon: React.ReactNode }

/**
 * The vacancy list has no loading.tsx (it made Next 15 drop search-param navigations), so
 * entering it shows the official Spinner in this icon slot while the link is pending.
 * Both glyphs stay rendered in one fixed slot (no layout shift) and swap after 100 ms, so
 * a fast navigation never flashes (Next useLinkStatus guidance). Must render inside the Link.
 */
function VacanciesLinkIcon() {
  const { pending } = useLinkStatus()
  return (
    <span className="grid size-4 shrink-0 *:col-start-1 *:row-start-1">
      <IconSearch aria-hidden="true" className={cn("size-4 transition-opacity", pending && "opacity-0 delay-100")} />
      <Spinner aria-hidden="true" className={cn("size-4 transition-opacity", pending ? "opacity-100 delay-100 animate-spin" : "opacity-0 animate-none")} />
    </span>
  )
}

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
  const viewer = useCandidateViewer()
  const showNavigation = viewer === "candidate"
  const { state, isMobile } = useSidebar()

  return (
    <Sidebar collapsible="offcanvas" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            {/* Native default geometry: the brand keeps the shared button's
                collapse behavior, its PeopleFlow link and its brand padding. */}
            <SidebarMenuButton className="data-[slot=sidebar-menu-button]:p-1.5! group-data-[collapsible=icon]:data-[slot=sidebar-menu-button]:p-0!" render={<Link href={showNavigation ? "/candidato/dashboard" : "/vacantes"} aria-label="PeopleFlow" />}>
              <PeopleFlowSidebarLogo collapsed={state === "collapsed" && !isMobile && props.collapsible === "icon"} />
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup><SidebarGroupContent><SidebarMenu><SidebarMenuItem>
          <SidebarMenuButton tooltip="Vacantes" isActive={isActiveCandidateDestination("/vacantes", pathname)} render={<Link href="/vacantes" />}>
            <VacanciesLinkIcon /><span className="group-data-[collapsible=icon]:sr-only">Vacantes</span>
          </SidebarMenuButton>
        </SidebarMenuItem></SidebarMenu></SidebarGroupContent></SidebarGroup>
        {showNavigation && CANDIDATE_NAV_GROUPS.map((group) => (
          <SidebarGroup key={group.label}>
            <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {/* Destinations use the native default geometry: no large rows
                    and no candidate-only icon-rail floor. */}
                {group.items.map((item) => (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton tooltip={item.title} isActive={isActiveCandidateDestination(item.url, pathname)} render={<Link href={item.url} />}>
                      {item.icon}
                      <span className="group-data-[collapsible=icon]:sr-only">{item.title}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>
      <SidebarFooter>
        {viewer === "loading" ? <CandidateFooterSkeleton /> : viewer === "visitor" || viewer === "pending" ? <CandidateVisitorFooter pending={viewer === "pending"} /> : <>
          {viewer === "recruiter" && (state === "collapsed" && !isMobile ? <SidebarMenu><SidebarMenuItem>
            <SidebarMenuButton tooltip="Ir a mi panel" render={<Link href="/empresa/dashboard" aria-label="Ir a mi panel" />}><IconLayoutDashboard aria-hidden="true" /></SidebarMenuButton>
          </SidebarMenuItem></SidebarMenu> : <Card size="sm">
            <CardHeader><CardTitle><h2 className="text-sm font-semibold leading-snug">Estás viendo las vacantes como las ve un candidato</h2></CardTitle></CardHeader>
            <CardFooter><Link href="/empresa/dashboard" className={buttonVariants({ className: "min-h-10 w-full" })}>Ir a mi panel</Link></CardFooter>
          </Card>)}
          <CandidateNavUser />
        </>}
      </SidebarFooter>
    </Sidebar>
  )
}
