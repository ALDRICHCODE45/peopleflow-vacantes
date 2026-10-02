"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"

import { PeopleFlowLogo } from "@/components/brand/logo"
import { NavUser } from "./nav-user"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "./ui/sidebar"
import {
  IconBriefcase,
  IconChartBar,
  IconCirclePlusFilled,
  IconLayoutDashboard,
  IconMessage,
  IconSettings,
  IconUsers,
  IconUsersGroup,
  IconWorld,
} from "@tabler/icons-react"

type NavItem = {
  title: string
  url: string
  icon: React.ReactNode
}

/**
 * Internal marker for destinations that are not routes yet. It never reaches the
 * DOM: unresolved items render as inert buttons instead of anchors.
 */
const UNRESOLVED_URL = "#"

/**
 * Recruiting navigation for the employer dashboard prototype.
 *
 * `Dashboard`, `Vacantes`, `Base de talento`, `Equipo` and `Sitio de empleo`
 * resolve to real routes and light up from the current pathname; every remaining
 * destination is a presentation placeholder: visible, enabled and inert, never
 * marked active.
 */
const data = {
  user: {
    // Employer account, not the product brand: the dashboard belongs to a
    // fictional company, while PeopleFlow only brands the sidebar header.
    name: "Tomás Ríos",
    email: "tomas.rios@nexolabs.mx",
    role: "Talent Lead",
    company: "Nexo Labs",
  },
  navPrincipal: [
    {
      title: "Dashboard",
      url: "/empresa/dashboard",
      icon: <IconLayoutDashboard />,
    },
    {
      title: "Vacantes",
      url: "/empresa/vacantes",
      icon: <IconBriefcase />,
    },
    {
      title: "Base de talento",
      url: "/empresa/talento",
      icon: <IconUsers />,
    },
    {
      title: "Mensajes",
      url: UNRESOLVED_URL,
      icon: <IconMessage />,
    },
  ],
  navOrganization: [
    {
      title: "Equipo",
      url: "/empresa/equipo",
      icon: <IconUsersGroup />,
    },
    {
      title: "Sitio de empleo",
      url: "/empresa/sitio",
      icon: <IconWorld />,
    },
    {
      title: "Reportes",
      url: UNRESOLVED_URL,
      icon: <IconChartBar />,
    },
    {
      title: "Configuración",
      url: UNRESOLVED_URL,
      icon: <IconSettings />,
    },
  ],
}

/**
 * A destination is active on its own route and on any route nested below it, so
 * `/empresa/vacantes/nueva` and `/empresa/vacantes/:id/pipeline` keep `Vacantes`
 * lit. Unresolved prototypes and unknown pathnames stay inactive.
 */
function isActiveDestination(url: string, pathname: string | null): boolean {
  if (url === UNRESOLVED_URL || !pathname) return false
  return pathname === url || pathname.startsWith(`${url}/`)
}

function NavLink({
  item,
  pathname,
}: {
  item: NavItem
  pathname: string | null
}) {
  const isResolved = item.url !== UNRESOLVED_URL
  return (
    <SidebarMenuItem>
      {/*
        Resolved destinations stay real Next links so the router owns
        navigation. Unresolved placeholders render as enabled native buttons
        without a destination, so they stay visible and keyboard-reachable while
        performing no navigation, request, storage write, state mutation,
        toast or success claim.
      */}
      <SidebarMenuButton
        tooltip={item.title}
        isActive={isActiveDestination(item.url, pathname)}
        render={
          isResolved ? <Link href={item.url} /> : <button type="button" />
        }
      >
        {item.icon}
        <span>{item.title}</span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  )
}

function NavGroup({
  label,
  items,
  pathname,
}: {
  label: string
  items: NavItem[]
  pathname: string | null
}) {
  return (
    <SidebarGroup>
      <SidebarGroupLabel>{label}</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {items.map((item) => (
            <NavLink key={item.title} item={item} pathname={pathname} />
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  )
}

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const pathname = usePathname()

  return (
    <Sidebar collapsible="offcanvas" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              className="data-[slot=sidebar-menu-button]:p-1.5!"
              render={<Link href="/empresa/dashboard" aria-label="PeopleFlow" />}
            >
              {/* The wordmark replaces the stock company glyph inside the same
                  20px box, one mark per color scheme via the brand classes. */}
              <PeopleFlowLogo className="h-5 w-auto" />
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Principal</SidebarGroupLabel>
          <SidebarGroupContent className="flex flex-col gap-2">
            <SidebarMenu>
              <SidebarMenuItem>
                {/*
                  Progressive enhancement: the primary action is a native GET
                  form, so the browser alone navigates to the create screen.
                  The control therefore stays a button instead of becoming an
                  anchor, and this sidebar needs no router, click handler or
                  client navigation runtime for the action itself.
                  `SidebarMenuButton` declares no button type of its own, so the
                  submit role is explicit here.
                */}
                <form action="/empresa/vacantes/nueva" method="get">
                  <SidebarMenuButton
                    type="submit"
                    tooltip="Nueva vacante"
                    className="min-w-8 bg-primary text-primary-foreground duration-200 ease-linear hover:bg-primary/90 hover:text-primary-foreground active:bg-primary/90 active:text-primary-foreground"
                  >
                    <IconCirclePlusFilled />
                    <span>Nueva vacante</span>
                  </SidebarMenuButton>
                </form>
              </SidebarMenuItem>
            </SidebarMenu>
            <SidebarMenu>
              {data.navPrincipal.map((item) => (
                <NavLink key={item.title} item={item} pathname={pathname} />
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        <NavGroup
          label="Organización"
          items={data.navOrganization}
          pathname={pathname}
        />
      </SidebarContent>
      <SidebarFooter>
        <NavUser user={data.user} />
      </SidebarFooter>
    </Sidebar>
  )
}
