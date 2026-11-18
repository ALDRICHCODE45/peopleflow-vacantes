import { DashboardPageContent } from "@/components/dashboard-page-content";
import { Skeleton } from "@/components/ui/skeleton";
import { CARD } from "@/features/company-metrics/sections/summary-strip";
import { cn } from "@/lib/utils";
import { LAYOUT, MAIN, RAIL } from "./layout";

/** Same footprint as the loaded page, card by card («Espacio del candidato» 9): pulses, never plays the entrance. */
export function ProfileSkeleton() {
  return <DashboardPageContent data-pf-profile-workspace width="screen-2xl">
    <div aria-busy="true" className="flex flex-col gap-6">
      <span role="status" className="sr-only">Cargando perfil</span>
      <div aria-hidden="true" data-pf-profile-skeleton-header="" className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
        <div className="flex flex-col gap-2.5"><Skeleton className="h-8 w-44" /><Skeleton className="h-3.5 w-72 max-w-full" /></div>
        <div className="flex gap-2 max-sm:hidden"><Skeleton className="h-11 w-56" /><Skeleton className="h-11 w-40" /></div>
      </div>
      <div aria-hidden="true" className={LAYOUT}>
        <div className={MAIN}>
          <div className={cn(CARD, "gap-4 px-4 py-5 sm:px-9 sm:py-8")}>
            <Skeleton className="h-3.5 w-72 max-w-full" />
            <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-5 gap-y-2">
              <Skeleton className="row-span-3 size-14 rounded-[18px] sm:size-20 sm:rounded-3xl" />
              <Skeleton className="h-7 w-64 max-w-full" /><Skeleton className="h-4 w-48 max-w-full" /><Skeleton className="h-3.5 w-72 max-w-full" />
            </div>
            <div className="flex gap-2"><Skeleton className="h-9 w-52 rounded-full" /><Skeleton className="h-9 w-40 rounded-full" /></div>
          </div>
          {[0, 1, 2].map(index => <div key={index} className={cn(CARD, "gap-4 p-4 sm:p-6")}>
            <Skeleton className="h-5 w-44" />
            <div className="grid grid-cols-2 gap-x-6 gap-y-3.5 xl:grid-cols-4">{[0, 1, 2, 3].map(cell => <Skeleton key={cell} className="h-9" />)}</div>
          </div>)}
        </div>
        <div className={RAIL}>
          <div className={cn(CARD, "gap-4 p-4 sm:p-5")}>
            <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-3.5"><Skeleton className="size-14 rounded-full" /><Skeleton className="h-8" /></div>
            <Skeleton className="h-16" />
          </div>
        </div>
      </div>
    </div>
  </DashboardPageContent>;
}
