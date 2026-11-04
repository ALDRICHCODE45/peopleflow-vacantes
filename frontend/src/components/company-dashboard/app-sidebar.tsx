"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import * as React from "react"

import { PeopleFlowSidebarLogo } from "@/components/brand/logo"
import { ActionStatus } from "@/components/feedback/action-status"
import { notifyActionResult } from "@/components/feedback/notify"
import { signOutWithAudit } from "@/lib/audit/sign-out"
import { useIdentity } from "@/features/identity/identity-session"
import { useCompanyMembership } from "@/features/employer-company/use-company-membership"
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
  useSidebar,
} from "./ui/sidebar"
import {
  IconBriefcase,
  IconCirclePlusFilled,
  IconLayoutDashboard,
  IconSettings,
  IconShieldCheck,
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

/** Owner-only destination: shown only once the membership says `owner` (the API enforces it too). */
const AUDIT_ITEM: NavItem = {
  title: "Auditoría",
  url: "/empresa/auditoria",
  icon: <IconShieldCheck />,
}

/**
 * A destination is active on its own route and on any route nested below it, so
 * `/empresa/vacantes/borradores/nuevo` and `/empresa/vacantes/:id/pipeline`
 * keep `Vacantes` lit. Unknown pathnames stay inactive.
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
        <span className="group-data-[collapsible=icon]:sr-only">{item.title}</span>
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
  const { result } = useIdentity()
  const showNavigation = !result?.ok || result.data.role === "recruiter"
  const user = result?.ok ? result.data.user : null
  const membership = useCompanyMembership(result?.ok && result.data.role === "recruiter" ? user?.id ?? null : null)
  const account = {
    name: user?.full_name ?? "Mi cuenta",
    email: user?.email ?? "",
    role: membership ? (membership.role === "owner" ? "Propietario" : "Reclutador") : result?.ok && result.data.role === "candidate" ? "Candidato" : "Empresa",
    company: membership?.company.name ?? "",
  }
  const { state, isMobile } = useSidebar()
  const [logoutPending, setLogoutPending] = React.useState(false)
  const [logoutFailed, setLogoutFailed] = React.useState(false)
  const logoutLock = React.useRef(false)
  const logoutStatusId = React.useId()

  // Records the session end, then NextAuth signOut, then the Cognito logout. A second click
  // is ignored while one is running; a failure is announced without exposing the exception.
  function logout() {
    if (logoutLock.current) return
    logoutLock.current = true
    setLogoutPending(true)
    setLogoutFailed(false)
    signOutWithAudit("/api/auth/cognito/logout")
      .catch(() => {
        setLogoutFailed(true)
        notifyActionResult({ key: "employer-logout", type: "error", title: "No pudimos cerrar la sesión", description: "Tu sesión puede seguir activa. Vuelve a intentarlo desde el menú.", reference: { at: new Date().toISOString() } })
      })
      .finally(() => {
        logoutLock.current = false
        setLogoutPending(false)
      })
  }

  return (
    <Sidebar collapsible="offcanvas" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              className="data-[slot=sidebar-menu-button]:p-1.5! group-data-[collapsible=icon]:data-[slot=sidebar-menu-button]:p-0!"
              render={<Link href="/empresa/dashboard" aria-label="PeopleFlow" />}
            >
              <PeopleFlowSidebarLogo collapsed={state === "collapsed" && !isMobile && props.collapsible === "icon"} />
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        {showNavigation && <>
        <SidebarGroup>
          <SidebarGroupLabel>Principal</SidebarGroupLabel>
          <SidebarGroupContent className="flex flex-col gap-2">
            <SidebarMenu>
              <SidebarMenuItem>
                {/*
                  Progressive enhancement: the primary action is a native GET
                  form, so the browser alone opens the canonical draft editor
                  at `/empresa/vacantes/borradores/nuevo` for a new vacancy.
                  The control therefore stays a button instead of becoming an
                  anchor, and this sidebar needs no router, click handler or
                  client navigation runtime for the action itself.
                  `SidebarMenuButton` declares no button type of its own, so the
                  submit role is explicit here.
                */}
                <form action="/empresa/vacantes/borradores/nuevo" method="get">
                  <SidebarMenuButton
                    type="submit"
                    tooltip="Nueva vacante"
                    className="min-w-8 bg-primary text-primary-foreground duration-200 ease-linear hover:bg-primary/90 hover:text-primary-foreground active:bg-primary/90 active:text-primary-foreground"
                  >
                    <IconCirclePlusFilled />
                    <span className="group-data-[collapsible=icon]:sr-only">Nueva vacante</span>
                  </SidebarMenuButton>
                </form>
              </SidebarMenuItem>
            </SidebarMenu>
            <SidebarMenu>
              {data.navPrincipal.filter((item) => item.url !== "/empresa/talento" || membership?.canViewTalentBase !== false).map((item) => (
                <NavLink key={item.title} item={item} pathname={pathname} />
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        <NavGroup
          label="Organización"
          items={membership?.role === "owner" ? [...data.navOrganization, AUDIT_ITEM] : data.navOrganization}
          pathname={pathname}
        />
        </>}
      </SidebarContent>
      <SidebarFooter>
        <NavUser
          user={account}
          secondaryText={account.email}
          showCompany
          menuItems={ACCOUNT_MENU}
          onLogout={logout}
          logoutPending={logoutPending}
          logoutStatusId={logoutFailed ? logoutStatusId : undefined}
        />
        {logoutFailed && <ActionStatus id={logoutStatusId} tone="error" text="No se cerró la sesión. Intenta nuevamente desde el menú." />}
      </SidebarFooter>
    </Sidebar>
  )
}
