import type { Metadata } from "next";
import { SiteHeader } from "@/components/company-dashboard/site-header";
import { EmployerSettingsWorkspace } from "@/features/employer-settings/settings-workspace";
import { DashboardPageContent } from "@/components/dashboard-page-content";
import { CompanySection } from "@/features/employer-company/company-section";

export const metadata: Metadata = { title: "Configuración" };

/** Company identity uses server actions; the existing preferences keep their own scope. */
export default function Page() {
  return (
    <>
      <SiteHeader title="Configuración" />
      <DashboardPageContent width="screen-2xl" className="pb-0 md:pb-0">
        <CompanySection />
      </DashboardPageContent>
      <EmployerSettingsWorkspace />
    </>
  );
}
