import type { Metadata } from "next";
import { SiteHeader } from "@/components/company-dashboard/site-header";
import { DashboardPageContent } from "@/components/dashboard-page-content";
import { CareersSiteLoader } from "./careers-site-loader";

export const metadata: Metadata = { title: "Sitio de empleo" };

/** The shared layout owns the employer shell. Authentication runs only inside
 * client-invoked server actions so refreshed session cookies can persist. */
export default function Page() {
  return (
    <>
      <SiteHeader title="Sitio de empleo" />
      <div className="@container/main flex flex-1 flex-col">
        <DashboardPageContent data-pf-sitio-content="" width="full" className="min-w-0 gap-5 md:gap-6">
          {/* No route loading boundary: Next 15 navigation regression #83386.
              The loader renders the editor skeleton while its action is pending. */}
          <CareersSiteLoader />
        </DashboardPageContent>
      </div>
    </>
  );
}
