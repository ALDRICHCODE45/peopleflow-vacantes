import type { Metadata } from "next";
import { SiteHeader } from "@/components/company-dashboard/site-header";
import { EmployerSettingsWorkspace } from "@/features/employer-settings/settings-workspace";
import { DashboardPageContent } from "@/components/dashboard-page-content";
import { CompanySection } from "@/features/employer-company/company-section";
import { TalentBaseVisibilitySection } from "@/features/talent-base-visibility/talent-base-visibility-section";

export const metadata: Metadata = { title: "Configuración" };

/** Company identity and the owner-only talent base visibility use server actions; the existing preferences keep their own scope. */
export default function Page() {
  return (
    <>
      <SiteHeader title="Configuración" />
      <DashboardPageContent width="screen-2xl" className="flex flex-col gap-6 pb-0 md:pb-0">
        <CompanySection />
        <TalentBaseVisibilitySection />
      </DashboardPageContent>
      <EmployerSettingsWorkspace />
    </>
  );
}
