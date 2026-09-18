"use client"

import Link from "next/link"

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
} from "@tabler/icons-react"

/**
 * Recruiting navigation for the employer dashboard prototype.
 *
 * Only `Dashboard` resolves to a real route; every other destination is an
 * unresolved product surface and therefore stays on the safe `#` placeholder.
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
      url: "#",
      icon: <IconBriefcase />,
    },
    {
      title: "Candidatos",
      url: "#",
      icon: <IconUsers />,
    },
    {
      title: "Mensajes",
      url: "#",
      icon: <IconMessage />,
    },
  ],
  navOrganization: [
    {
      title: "Equipo",
      url: "#",
      icon: <IconUsersGroup />,
    },
    {
      title: "Reportes",
      url: "#",
      icon: <IconChartBar />,
    },
    {
      title: "Configuración",
      url: "#",
      icon: <IconSettings />,
    },
  ],
}

function NavGroup({
  label,
  items,
}: {
  label: string
  items: { title: string; url: string; icon: React.ReactNode }[]
}) {
  return (
    <SidebarGroup>
      <SidebarGroupLabel>{label}</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {items.map((item) => (
            <SidebarMenuItem key={item.title}>
              <SidebarMenuButton
                tooltip={item.title}
                isActive={item.url !== "#"}
                render={<a href={item.url} />}
              >
                {item.icon}
                <span>{item.title}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  )
}

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
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
                <SidebarMenuButton
                  tooltip="Nueva vacante"
                  className="min-w-8 bg-primary text-primary-foreground duration-200 ease-linear hover:bg-primary/90 hover:text-primary-foreground active:bg-primary/90 active:text-primary-foreground"
                >
                  <IconCirclePlusFilled />
                  <span>Nueva vacante</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
            <SidebarMenu>
              {data.navPrincipal.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton
                    tooltip={item.title}
                    isActive={item.url !== "#"}
                    render={<a href={item.url} />}
                  >
                    {item.icon}
                    <span>{item.title}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        <NavGroup label="Organización" items={data.navOrganization} />
      </SidebarContent>
      <SidebarFooter>
        <NavUser user={data.user} />
      </SidebarFooter>
    </Sidebar>
  )
}
