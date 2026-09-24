import { SidebarTrigger } from "@/components/company-dashboard/ui/sidebar"
import { ThemeToggle } from "@/components/theme/theme-toggle"
import { Separator } from "@/components/ui/separator"

/**
 * Route header for the create-vacancy screen.
 *
 * Presentational only, and deliberately not a client component: it reuses the
 * committed shell primitives and adds this route's own title plus a read-only
 * context trail. "Vacantes" is plain text rather than a link because the
 * employer vacancies list is not implemented, so the header must not advertise
 * a destination that does not exist.
 */
export function CreateVacancyHeader() {
  return (
    <header className="flex h-(--header-height) shrink-0 items-center gap-2 border-b transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-(--header-height)">
      <div className="flex w-full min-w-0 items-center gap-1 px-4 lg:gap-2 lg:px-6">
        <SidebarTrigger className="-ml-1" />
        <Separator
          orientation="vertical"
          className="mx-2 h-4 data-vertical:self-auto"
        />
        <div className="flex min-w-0 flex-col justify-center">
          <nav aria-label="Ruta de navegación">
            <ol className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <li className="truncate">Vacantes</li>
              {/*
                Decorative separator: hidden from assistive technology so the
                trail is announced as context, not as punctuation.
              */}
              <li aria-hidden="true" className="select-none">
                /
              </li>
              <li aria-current="page" className="truncate">
                Nueva vacante
              </li>
            </ol>
          </nav>
          <h1 className="truncate text-base font-medium">Nueva vacante</h1>
        </div>
        {/*
          The theme control keeps the committed header's top-right position and
          stays reachable at every breakpoint. No account, login or identity
          control is mounted here: this route owns no credential surface.
        */}
        <div className="ml-auto flex shrink-0 items-center gap-2">
          <ThemeToggle />
        </div>
      </div>
    </header>
  )
}
