import { Separator } from "@/components/ui/separator"
import { ThemeToggle } from "@/components/theme/theme-toggle"
import { SidebarTrigger } from "./ui/sidebar"

export function SiteHeader() {
  return (
    <header className="flex h-(--header-height) shrink-0 items-center gap-2 border-b transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-(--header-height)">
      <div className="flex w-full items-center gap-1 px-4 lg:gap-2 lg:px-6">
        <SidebarTrigger className="-ml-1" />
        <Separator
          orientation="vertical"
          className="mx-2 h-4 data-vertical:self-auto"
        />
        <h1 className="text-base font-medium">Dashboard</h1>
        {/*
          Canonical PeopleFlow theme control, reused as-is: this header owns no
          theme state, storage key or bootstrap of its own. Its `size="icon"`
          (32px) is the narrowest standard control that fits the fixed
          `h-(--header-height)` header and its untouched padding, and it is now
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
