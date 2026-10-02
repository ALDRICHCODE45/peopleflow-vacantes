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
  IconCirclePlusFilled,
  IconLayoutDashboard,
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

/** Recruiting navigation: every visible destination has an implemented page. */
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
      title: "Configuración",
      url: "/empresa/configuracion",
      icon: <IconSettings />,
    },
  ],
}

/**
 * A destination is active on its own route and on any route nested below it, so
 * `/empresa/vacantes/nueva` and `/empresa/vacantes/:id/pipeline` keep `Vacantes`
 * lit. Unknown pathnames stay inactive.
 */
function isActiveDestination(url: string, pathname: string | null): boolean {
  if (!pathname) return false
  return pathname === url || pathname.startsWith(`${url}/`)
}

function NavLink({
  item,
  pathname,
}: {
  item: NavItem
  pathname: string | null
}) {
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        tooltip={item.title}
        isActive={isActiveDestination(item.url, pathname)}
        render={<Link href={item.url} />}
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

const ACCOUNT_MENU = [
  { title: "Configuración", href: "/empresa/configuracion", icon: <IconSettings /> },
  { title: "Equipo", href: "/empresa/equipo", icon: <IconUsersGroup /> },
  { title: "Sitio de empleo", href: "/empresa/sitio", icon: <IconWorld /> },
] as const

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
        <NavUser user={data.user} menuItems={ACCOUNT_MENU} />
      </SidebarFooter>
    </Sidebar>
  )
}
