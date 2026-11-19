import { DashboardPageContent } from "@/components/dashboard-page-content";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { ASIDE, LAYOUT, TAB_CARD } from "./layout";

/** Same footprint as the loaded page, card by card («Espacio del candidato» 9): pulses, never plays the entrance. */
export function ProfileSkeleton() {
  return <DashboardPageContent data-pf-profile-workspace width="screen-2xl">
    <div aria-busy="true" className="flex flex-col gap-6">
      <span role="status" className="sr-only">Cargando perfil</span>
      <div aria-hidden="true" className="flex flex-col gap-2.5"><Skeleton className="h-8 w-44" /><Skeleton className="h-3.5 w-56 max-w-full" /></div>
      <div aria-hidden="true" className={LAYOUT}>
        <div className={ASIDE}>
          <div className={cn(TAB_CARD, "overflow-hidden")}>
            <Skeleton className="h-12 rounded-none sm:h-[88px]" />
            <div className="flex flex-col gap-3 px-4 pb-4 sm:px-5 sm:pb-5">
              <Skeleton className="-mt-5 size-14 rounded-[18px] ring-4 ring-card sm:-mt-9 sm:size-[72px] sm:rounded-[22px]" />
              <Skeleton className="h-6 w-3/5" /><Skeleton className="h-5 w-2/5" />
              <div className="grid grid-cols-2 gap-2"><Skeleton className="h-14 rounded-xl" /><Skeleton className="h-14 rounded-xl" /></div>
              <div className="flex flex-wrap gap-1.5 max-sm:hidden">{["w-16", "w-14", "w-20", "w-18"].map(width => <Skeleton key={width} className={cn("h-6 rounded-full", width)} />)}</div>
            </div>
            <div className="flex items-center gap-3 border-t border-border px-4 py-3.5 sm:px-5"><Skeleton className="size-10 rounded-full" /><Skeleton className="h-8 w-40" /></div>
          </div>
        </div>
        <div className={TAB_CARD}>
          <div className="flex gap-6 overflow-hidden border-b border-border px-6 pt-4 pb-3.5 max-sm:border-b-0 max-sm:px-3">{["w-16", "w-20", "w-20", "w-24", "w-14"].map(width => <Skeleton key={width} className={cn("h-4 shrink-0", width)} />)}</div>
          <div className="flex flex-col gap-5 p-4 sm:px-7 sm:pt-5 sm:pb-7">
            <div className="flex items-center justify-between gap-3"><Skeleton className="h-3.5 w-52" /><Skeleton className="h-10 w-24" /></div>
            <div className="grid grid-cols-1 gap-x-6 gap-y-5 min-[480px]:grid-cols-2">{[0, 1, 2, 3, 4, 5].map(cell => <div key={cell} className="flex flex-col gap-2"><Skeleton className="h-3 w-2/5" /><Skeleton className="h-4 w-3/5" /></div>)}</div>
          </div>
        </div>
      </div>
    </div>
  </DashboardPageContent>;
}
