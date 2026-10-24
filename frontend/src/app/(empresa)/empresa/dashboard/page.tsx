import type { Metadata } from "next";
import { DashboardPageContent } from "@/components/dashboard-page-content";
import { SiteHeader } from "@/components/company-dashboard/site-header";
import { DashboardWorkspace } from "@/features/employer-dashboard/workspace";
export const metadata: Metadata = { title: "Panel de empresa" };
export default function Page() {
  return <><SiteHeader /><div className="@container/main flex flex-1 flex-col"><DashboardPageContent width="screen-2xl" className="gap-4 md:gap-6"><DashboardWorkspace /></DashboardPageContent></div></>;
}
